import { describe, expect, it } from 'vitest'
import { importSPKI, jwtVerify } from 'jose'
import { AuthService, hashFingerprint, hashPassword, powervpnUsernameBase } from './auth.js'
import { classifyRefresh, REFRESH_RETRY_GRACE_MS } from './store.js'
import type { DeviceRecord, Entitlement, PgStore, SessionRecord, UserRecord } from './store.js'

class FakeStore {
  user!: UserRecord
  entitlementValue!: Entitlement
  device!: DeviceRecord
  sessions = new Map<string, SessionRecord>()
  /** old jti → jti issued by its rotation (Postgres links them by created_at = consumed_at). */
  successors = new Map<string, string>()
  clockOffsetMs = 0
  now() { return new Date(Date.now() + this.clockOffsetMs) }
  revokedFamilies: string[] = []
  async recordLoginFailure() {
    this.user.failedLoginCount += 1
    if (this.user.failedLoginCount >= 5) {
      this.user.failedLoginCount = 0
      this.user.lockoutLevel += 1
      this.user.lockedUntil = new Date(Date.now() + this.user.lockoutLevel * 5 * 60000)
    }
    return { failedLoginCount: this.user.failedLoginCount, lockoutLevel: this.user.lockoutLevel, lockedUntil: this.user.lockedUntil }
  }
  async recordLoginSuccess() { this.user.failedLoginCount = 0; this.user.lockedUntil = null }
  async claimTrialOnLogin() { return null }
  async findUser(username: string) { return username === this.user.username ? this.user : null }
  async findUserById(id: string) { return id === this.user.id ? this.user : null }
  async entitlement() { return this.entitlementValue }
  async bindDevice(userId: string, fingerprintHash: string, hardwareHash: string, name: string, platform: string, appVersion: string) { this.device = { id: '22222222-2222-4222-8222-222222222222', userId, fingerprintHash, hardwareHash, name, platform, appVersion, revoked: false }; return this.device }
  async createSession(value: { userId: string; deviceId: string; familyId: string; jti: string; tokenHash: string; expiresAt: Date }) { this.sessions.set(value.jti, { ...value, consumedAt: null, revokedAt: null, fingerprintHash: this.device.fingerprintHash }) }
  async findSession(jti: string) { return this.sessions.get(jti) ?? null }
  async consumeSession(jti: string) { const s = this.sessions.get(jti); if (!s || s.consumedAt) return false; s.consumedAt = new Date(); return true }
  async revokeFamily(family: string) { this.revokedFamilies.push(family); for (const s of this.sessions.values()) if (s.familyId === family) s.revokedAt = new Date() }
  async rotateSessionAtomic(input: { oldJti: string; familyId: string; oldTokenHash: string; fingerprintHash: string; newJti: string; newTokenHash: string; expiresAt: Date }) {
    const session = this.sessions.get(input.oldJti)
    if (!session) return { ok: false, reason: 'invalid' } as const
    const successorJti = this.successors.get(input.oldJti)
    const successor = successorJti ? this.sessions.get(successorJti) ?? null : null
    const verdict = classifyRefresh(session, { familyId: input.familyId, tokenHash: input.oldTokenHash, fingerprintHash: input.fingerprintHash }, successor, this.now())
    if (verdict === 'replay') {
      await this.revokeFamily(session.familyId)
      return { ok: false, reason: 'replay' } as const
    }
    if (verdict === 'device') return { ok: false, reason: 'device' } as const
    if (verdict === 'retry' && successor) successor.revokedAt = this.now()
    session.consumedAt = this.now()
    this.successors.set(input.oldJti, input.newJti)
    this.sessions.set(input.newJti, {
      jti: input.newJti, familyId: session.familyId, userId: session.userId, deviceId: session.deviceId,
      tokenHash: input.newTokenHash, consumedAt: null, revokedAt: null, expiresAt: input.expiresAt,
      fingerprintHash: session.fingerprintHash,
    })
    return { ok: true, userId: session.userId, deviceId: session.deviceId } as const
  }
  identities = new Map<string, string>()
  identityCalls: { usernameBase: string; email: string | null }[] = []
  async findOrCreateIdentityUser(input: { provider: string; externalId: string; usernameBase: string; email: string | null }) {
    this.identityCalls.push({ usernameBase: input.usernameBase, email: input.email })
    const key = input.provider + ':' + input.externalId
    if (this.identities.has(key)) return { user: this.user, created: false }
    this.user = { ...this.user, username: input.usernameBase, passwordHash: null }
    this.identities.set(key, this.user.id)
    return { user: this.user, created: true }
  }
  aigwSyncs: (string | null)[] = []
  async syncAigwLicense(_id: string, until: Date | null) {
    this.aigwSyncs.push(until ? until.toISOString() : null)
    return { changed: true, expiresAt: until }
  }
  async identityOwner(_p: string, externalId: string) {
    return this.identities.get('powervpn:' + externalId) ?? null
  }
  channelMarks: string[] = []
  async markUserChannel(_id: string, channel: '' | 'aigw') {
    if (!channel || this.user.channel === channel) return false
    this.channelMarks.push(channel)
    this.user = { ...this.user, channel }
    return true
  }
  async isDeviceWithinLimit() { return true }
  async audit() {}
  async findDevice(id: string) { return id === this.device.id ? this.device : null }
  async touchDevice() {}
  async getCommerceSettings(){return {registrationEnabled:true,trialDays:3,trialPlanCode:'trial',defaultDeviceLimit:3,licenseLeaseMinutes:60,offlineGraceHours:6,activePaymentProvider:'zhongzhuan-prod'}}
  async latestRelease() { return { version: '2.0.0', minimumVersion: '1.9.0', url: 'https://download.invalid/app.exe', sha256: 'a'.repeat(64), signature: 'signature', mandatory: false, title:'', summary:'', changelog:'', channel:'stable', publishedAt: new Date() } }
}

async function fixture() {
  const store = new FakeStore()
  store.user = { id: '11111111-1111-4111-8111-111111111111', username: 'alice', passwordHash: await hashPassword('correct horse battery staple'), role: 'user', status: 'active', createdAt: new Date(), failedLoginCount: 0, lockoutLevel: 0, lockedUntil: null, channel: '' }
  store.entitlementValue = { licenseId: '33333333-3333-4333-8333-333333333333', planId: '44444444-4444-4444-8444-444444444444', planCode:'premium-test', planName: 'Professional', tier:'premium', maxDevices: 3, features: ['proxy', 'custom-lines'], expiresAt: new Date(Date.now() + 7 * 86400000), lifetime:false, status: 'active' }
  const auth = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30 })
  const device = { fingerprint: 'f'.repeat(64), name: 'Windows PC', platform: 'windows' as const, appVersion: '1.9.0' }
  return { store, auth, device }
}

describe('commercial auth', () => {
  it('locks an account for five minutes after five wrong passwords', async () => {
    const { auth, device } = await fixture()
    for (let i = 0; i < 4; i++) await expect(auth.login({ username: 'alice', password: 'wrong password', device })).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    await expect(auth.login({ username: 'alice', password: 'wrong password', device })).rejects.toMatchObject({ code: 'AUTH_LOCKED', status: 429 })
    await expect(auth.login({ username: 'alice', password: 'correct horse battery staple', device })).rejects.toMatchObject({ code: 'AUTH_LOCKED' })
  })

  it('rotates refresh tokens and revokes the family on replay', async () => {
    const { store, auth, device } = await fixture()
    const login = await auth.login({ username: 'Alice', password: 'correct horse battery staple', device })
    const rotated = await auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint })
    expect(rotated.refreshToken).not.toBe(login.refreshToken)
    // The successor has been used, so presenting the old token again is a real replay.
    await auth.rotate({ refreshToken: rotated.refreshToken, deviceFingerprint: device.fingerprint })
    await expect(auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint })).rejects.toMatchObject({ code: 'REFRESH_REPLAY' })
    expect(store.revokedFamilies).toHaveLength(1)
  })

  it('treats a re-sent token whose rotation response was lost as a retry', async () => {
    const { store, auth, device } = await fixture()
    const login = await auth.login({ username: 'alice', password: 'correct horse battery staple', device })
    const lost = await auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint })
    store.clockOffsetMs = 60_000 // the client retries on its next minute tick
    const retried = await auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint })
    expect(retried.refreshToken).not.toBe(lost.refreshToken)
    expect(store.revokedFamilies).toHaveLength(0)
    // The undelivered pair is retired: only the retried token stays usable.
    await expect(auth.rotate({ refreshToken: lost.refreshToken, deviceFingerprint: device.fingerprint })).rejects.toMatchObject({ code: 'REFRESH_REPLAY' })
  })

  it('still revokes a re-sent token after the grace window or from another device', async () => {
    const late = await fixture()
    const login = await late.auth.login({ username: 'alice', password: 'correct horse battery staple', device: late.device })
    await late.auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: late.device.fingerprint })
    late.store.clockOffsetMs = REFRESH_RETRY_GRACE_MS + 1000
    await expect(late.auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: late.device.fingerprint })).rejects.toMatchObject({ code: 'REFRESH_REPLAY' })

    const other = await fixture()
    const otherLogin = await other.auth.login({ username: 'alice', password: 'correct horse battery staple', device: other.device })
    await other.auth.rotate({ refreshToken: otherLogin.refreshToken, deviceFingerprint: other.device.fingerprint })
    await expect(other.auth.rotate({ refreshToken: otherLogin.refreshToken, deviceFingerprint: 'e'.repeat(64) })).rejects.toMatchObject({ code: 'REFRESH_REPLAY' })
  })

  it('keeps exactly one live token when the same refresh token is rotated concurrently', async () => {
    const { store, auth, device } = await fixture()
    const login = await auth.login({ username: 'alice', password: 'correct horse battery staple', device })
    await Promise.allSettled([
      auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint }),
      auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint }),
    ])
    const live = [...store.sessions.values()].filter(s => !s.consumedAt && !s.revokedAt)
    expect(live).toHaveLength(1)
  })

  it('classifies refresh presentations', () => {
    const now = new Date('2026-10-05T04:54:13Z')
    const base = { familyId: 'f', tokenHash: 'h', consumedAt: null, revokedAt: null, expiresAt: new Date('2026-12-01T00:00:00Z'), fingerprintHash: 'fp' }
    const input = { familyId: 'f', tokenHash: 'h', fingerprintHash: 'fp' }
    const consumed = { ...base, consumedAt: new Date('2026-10-05T04:53:12Z') }
    expect(classifyRefresh(base, input, null, now)).toBe('rotate')
    expect(classifyRefresh(base, { ...input, fingerprintHash: 'x' }, null, now)).toBe('device')
    expect(classifyRefresh(consumed, input, { consumedAt: null, revokedAt: null }, now)).toBe('retry')
    expect(classifyRefresh(consumed, input, { consumedAt: now, revokedAt: null }, now)).toBe('replay')
    expect(classifyRefresh(consumed, input, { consumedAt: null, revokedAt: now }, now)).toBe('replay')
    expect(classifyRefresh(consumed, input, null, now)).toBe('replay')
    expect(classifyRefresh({ ...consumed, revokedAt: now }, input, { consumedAt: null, revokedAt: null }, now)).toBe('replay')
  })

  it('issues an Ed25519 lease bound to the authenticated device', async () => {
    const { auth, device } = await fixture()
    const login = await auth.login({ username: 'alice', password: 'correct horse battery staple', device })
    const principal = await auth.verifyAccess(login.accessToken)
    const lease = await auth.lease(principal.userId, principal.deviceId, device.fingerprint, device.appVersion)
    const key = await importSPKI(auth.publicKeyPem, 'EdDSA')
    const { payload } = await jwtVerify(lease.lease, key, { algorithms: ['EdDSA'] })
    expect(payload.did).toBe(principal.deviceId)
    expect(payload.features).toEqual(['proxy', 'custom-lines'])
    expect(payload.minVersion).toBe('1.9.0')
  })

  it('never accepts the lease on a different device fingerprint', async () => {
    const { auth, device } = await fixture()
    const login = await auth.login({ username: 'alice', password: 'correct horse battery staple', device })
    const principal = await auth.verifyAccess(login.accessToken)
    await expect(auth.lease(principal.userId, principal.deviceId, '0'.repeat(64), device.appVersion)).rejects.toMatchObject({ code: 'DEVICE_MISMATCH' })
  })

  it('logs in with a POWER云 token, creating a password-less user once', async () => {
    const { store, device } = await fixture()
    const seen: string[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push(url + ' ' + String((init.headers as Record<string, string>).authorization))
      return new Response(JSON.stringify({ id: 'ABCDEF12-3456-7890', username: 'bob', email: 'bob@example.com', displayName: 'Bob' }), { status: 200 })
    }) as unknown as typeof fetch
    const auth = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30, powervpn: { baseUrl: 'https://panel.test/', fetch: fakeFetch } })
    const first = await auth.loginPowervpn({ accessToken: 'panel-access-token-123', device })
    expect(first.refreshToken).toBeTruthy()
    expect(seen[0]).toBe('https://panel.test/api/client/me Bearer panel-access-token-123')
    expect(store.identityCalls[0]).toEqual({ usernameBase: 'pv_abcdef12', email: 'bob@example.com' })
    await auth.loginPowervpn({ accessToken: 'panel-access-token-123', device })
    expect(store.identities.size).toBe(1)
    // 无密码账号不能用密码登录，提示走 POWER云
    await expect(auth.login({ username: 'pv_abcdef12', password: 'whatever-password', device })).rejects.toMatchObject({ code: 'PASSWORD_NOT_SET' })
    // 老面板不给 sources：不是中转站客户
    expect(first.user?.channel).toBe('')
    expect(store.channelMarks).toHaveLength(0)
  })

  it('marks POWER云 customers who came from the AI site (sources has aigw) as channel aigw, once', async () => {
    const { store, device } = await fixture()
    const me = { id: 'ABCDEF12-3456-7890', username: 'ai0782', email: null, displayName: 'ai0782', sources: ['aigw'] }
    const fakeFetch = (async () => new Response(JSON.stringify(me), { status: 200 })) as unknown as typeof fetch
    const auth = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30, powervpn: { baseUrl: 'https://panel.test', fetch: fakeFetch } })
    const first = await auth.loginPowervpn({ accessToken: 'panel-access-token-123', device })
    expect(first.user?.channel).toBe('aigw')
    await auth.loginPowervpn({ accessToken: 'panel-access-token-123', device })
    expect(store.channelMarks).toEqual(['aigw'])
    // 刷新令牌轮换后也带渠道（客户端据此持续隐藏联系方式）
    const rotated = await auth.rotate({ refreshToken: first.refreshToken, deviceFingerprint: device.fingerprint })
    expect(rotated.user.channel).toBe('aigw')
    // 面板给了奇怪的 sources 也不影响登录
    const odd = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30, powervpn: { baseUrl: 'https://panel.test', fetch: (async () => new Response(JSON.stringify({ ...me, sources: 'aigw' }), { status: 200 })) as unknown as typeof fetch } })
    await expect(odd.loginPowervpn({ accessToken: 'panel-access-token-123', device })).resolves.toMatchObject({ refreshToken: expect.any(String) })
  })

  it('pre-provisions a POWER云-linked account for delivery before the customer ever logs in', async () => {
    const { store, auth } = await fixture()
    const made = await auth.provisionPowervpnUser({ externalId: 'B303FE4C-0000', email: null, channel: 'aigw' })
    expect(made).toMatchObject({ username: 'pv_b303fe4c', channel: 'aigw', created: true })
    const again = await auth.provisionPowervpnUser({ externalId: 'B303FE4C-0000', email: null, channel: 'aigw' })
    expect(again).toMatchObject({ id: made.id, created: false })
    expect(store.identities.size).toBe(1)
  })

  it('lets a password-less account set a first password but still checks it afterwards', async () => {
    const { store, auth } = await fixture()
    store.user = { ...store.user, passwordHash: null }
    const updates: string[] = []
    ;(store as unknown as { setUserPassword: (id: string, hash: string) => Promise<boolean> }).setUserPassword = async (_id, hash) => { updates.push(hash); return true }
    await auth.changeOwnPassword(store.user.id, { currentPassword: '', newPassword: 'brand-new-password' })
    expect(updates).toHaveLength(1)
    store.user = { ...store.user, passwordHash: await hashPassword('brand-new-password') }
    await expect(auth.changeOwnPassword(store.user.id, { currentPassword: '', newPassword: 'another-password' })).rejects.toMatchObject({ code: 'PASSWORD_INVALID' })
  })

  it('rejects an invalid POWER云 token and reports panel outages', async () => {
    const { store, device } = await fixture()
    const make = (status: number) => AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30, powervpn: { baseUrl: 'https://panel.test', fetch: (async () => new Response('{}', { status })) as unknown as typeof fetch } })
    await expect((await make(401)).loginPowervpn({ accessToken: 'bad-token-xxxxxxxxxx', device })).rejects.toMatchObject({ code: 'POWERVPN_TOKEN_INVALID', status: 401 })
    await expect((await make(502)).loginPowervpn({ accessToken: 'bad-token-xxxxxxxxxx', device })).rejects.toMatchObject({ code: 'POWERVPN_UNAVAILABLE' })
    // 200 but not a valid ClientMe (missing / wrong-typed id) → rejected, no user created
    await expect((await make(200)).loginPowervpn({ accessToken: 'bad-token-xxxxxxxxxx', device })).rejects.toMatchObject({ code: 'POWERVPN_UNAVAILABLE', status: 502 })
    const odd = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30, powervpn: { baseUrl: 'https://panel.test', fetch: (async () => new Response(JSON.stringify({ id: { $ne: null } }), { status: 200 })) as unknown as typeof fetch } })
    await expect(odd.loginPowervpn({ accessToken: 'bad-token-xxxxxxxxxx', device })).rejects.toMatchObject({ code: 'POWERVPN_UNAVAILABLE' })
    expect(store.identityCalls).toHaveLength(0)
    const disabled = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30 })
    await expect(disabled.loginPowervpn({ accessToken: 'bad-token-xxxxxxxxxx', device })).rejects.toMatchObject({ code: 'POWERVPN_DISABLED' })
    expect(powervpnUsernameBase('1234-5678-90ab')).toBe('pv_12345678')
  })

  it('syncs the AI-site membership to the POWER云 AI plan expiry on login and on demand', async () => {
    const { store, device } = await fixture()
    let me: Record<string, unknown> = { id: 'ABCDEF12-3456-7890', username: 'ai0782', email: null, displayName: 'ai0782', sources: ['aigw'], aiPlanExpiresAt: '2026-10-30T13:12:24.836Z' }
    const fakeFetch = (async () => new Response(JSON.stringify(me), { status: 200 })) as unknown as typeof fetch
    const auth = await AuthService.create(store as unknown as PgStore, { accessSecret: 'test-secret-must-be-at-least-32-bytes-long', refreshDays: 30, powervpn: { baseUrl: 'https://panel.test', fetch: fakeFetch } })
    await auth.loginPowervpn({ accessToken: 'panel-access-token-123', device })
    expect(store.aigwSyncs).toEqual(['2026-10-30T13:12:24.836Z'])
    // AI 到期（面板给 null）→ 这一行结束
    me = { ...me, aiPlanExpiresAt: null }
    const r = await auth.syncPowervpn(store.user.id, 'panel-access-token-123')
    expect(store.aigwSyncs.at(-1)).toBeNull()
    expect(r.channel).toBe('aigw')
    // 老面板不给这个字段：不动会员
    me = { id: 'ABCDEF12-3456-7890', username: 'ai0782', sources: ['aigw'] }
    await auth.syncPowervpn(store.user.id, 'panel-access-token-123')
    expect(store.aigwSyncs).toHaveLength(2)
    // 拿别人的 POWER云 令牌来同步：拒绝
    me = { id: 'FFFFFFFF-0000', username: 'other', sources: [], aiPlanExpiresAt: '2030-01-01T00:00:00Z' }
    await expect(auth.syncPowervpn(store.user.id, 'panel-access-token-123')).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
    expect(store.aigwSyncs).toHaveLength(2)
  })
})

