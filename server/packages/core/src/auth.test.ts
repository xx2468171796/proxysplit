import { describe, expect, it } from 'vitest'
import { importSPKI, jwtVerify } from 'jose'
import { AuthService, hashFingerprint, hashPassword } from './auth.js'
import type { DeviceRecord, Entitlement, PgStore, SessionRecord, UserRecord } from './store.js'

class FakeStore {
  user!: UserRecord
  entitlementValue!: Entitlement
  device!: DeviceRecord
  sessions = new Map<string, SessionRecord>()
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
  async findUser(username: string) { return username === this.user.username ? this.user : null }
  async findUserById(id: string) { return id === this.user.id ? this.user : null }
  async entitlement() { return this.entitlementValue }
  async bindDevice(userId: string, fingerprintHash: string, hardwareHash: string, name: string, platform: string, appVersion: string) { this.device = { id: '22222222-2222-4222-8222-222222222222', userId, fingerprintHash, hardwareHash, name, platform, appVersion, revoked: false }; return this.device }
  async createSession(value: { userId: string; deviceId: string; familyId: string; jti: string; tokenHash: string; expiresAt: Date }) { this.sessions.set(value.jti, { ...value, consumedAt: null, revokedAt: null, fingerprintHash: this.device.fingerprintHash }) }
  async findSession(jti: string) { return this.sessions.get(jti) ?? null }
  async consumeSession(jti: string) { const s = this.sessions.get(jti); if (!s || s.consumedAt) return false; s.consumedAt = new Date(); return true }
  async revokeFamily(family: string) { this.revokedFamilies.push(family); for (const s of this.sessions.values()) if (s.familyId === family) s.revokedAt = new Date() }
  async audit() {}
  async findDevice(id: string) { return id === this.device.id ? this.device : null }
  async touchDevice() {}
  async getCommerceSettings(){return {registrationEnabled:true,trialDays:3,trialPlanCode:'trial',defaultDeviceLimit:3,licenseLeaseMinutes:60,offlineGraceHours:6,activePaymentProvider:'zhongzhuan-prod'}}
  async latestRelease() { return { version: '2.0.0', minimumVersion: '1.9.0', url: 'https://download.invalid/app.exe', sha256: 'a'.repeat(64), signature: 'signature', mandatory: false, title:'', summary:'', changelog:'', channel:'stable', publishedAt: new Date() } }
}

async function fixture() {
  const store = new FakeStore()
  store.user = { id: '11111111-1111-4111-8111-111111111111', username: 'alice', passwordHash: await hashPassword('correct horse battery staple'), role: 'user', status: 'active', createdAt: new Date(), failedLoginCount: 0, lockoutLevel: 0, lockedUntil: null }
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
    await expect(auth.rotate({ refreshToken: login.refreshToken, deviceFingerprint: device.fingerprint })).rejects.toMatchObject({ code: 'REFRESH_REPLAY' })
    expect(store.revokedFamilies).toHaveLength(1)
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
})
