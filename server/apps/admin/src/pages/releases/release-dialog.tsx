// 发布新版本表单：版本号 x.y.z、https 的 .exe 地址、sha256 64 位小写十六进制、签名 ≥ 32 字符。
import * as React from 'react'
import { FormDialog, FormField, FormSection, Input, SegmentedControl, Switch, Textarea, useNotify } from '@ankotti/admin-ui'
import { post } from '@/lib/api'

export type Release = {
  id: string; version: string; minimumVersion: string; url: string; sha256: string; signature: string
  mandatory: boolean; title: string; summary: string; changelog: string; channel: string; publishedAt: string
}
type Draft = Omit<Release, 'id' | 'publishedAt'>
const EMPTY: Draft = { version: '', minimumVersion: '', url: '', sha256: '', signature: '', mandatory: true, title: '', summary: '', changelog: '', channel: 'stable' }

const SEMVER = /^\d+\.\d+\.\d+$/
function urlError(v: string): string | null {
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return '必须是 https 地址'
    if (!u.pathname.toLowerCase().endsWith('.exe')) return '地址路径要以 .exe 结尾'
    return null
  } catch { return '请填写完整的下载地址' }
}

export function fieldErrors(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {}
  if (!SEMVER.test(d.version.trim())) e.version = '版本号写成 x.y.z，例如 1.10.12'
  if (!SEMVER.test(d.minimumVersion.trim())) e.minimumVersion = '最低版本写成 x.y.z'
  const u = urlError(d.url.trim())
  if (u) e.url = u
  if (!/^[0-9a-f]{64}$/.test(d.sha256.trim())) e.sha256 = 'SHA-256 是 64 位小写十六进制'
  if (d.signature.trim().length < 32) e.signature = '签名至少 32 个字符'
  if (d.title.length > 120) e.title = '标题最多 120 字'
  if (d.summary.length > 500) e.summary = '摘要最多 500 字'
  if (d.changelog.length > 20000) e.changelog = '更新日志最多 20000 字'
  return e
}

export function ReleaseDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const [d, setD] = React.useState(EMPTY)
  const [touched, setTouched] = React.useState<Partial<Record<keyof Draft, boolean>>>({})
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const errs = fieldErrors(d)
  const shown = (k: keyof Draft) => {
    const msg = errs[k]
    return touched[k] && msg ? { error: msg } : {}
  }
  const blur = (k: keyof Draft) => () => setTouched((t) => ({ ...t, [k]: true }))
  return (
    <FormDialog open size="lg" title="发布新版本" description="客户端按渠道检查更新；低于「最低版本」或勾了强制更新的会被要求升级。安装包必须已上传并签名。"
      dirty={JSON.stringify(d) !== JSON.stringify(EMPTY)} submitLabel="发布" onClose={onClose}
      onSubmit={async () => {
        setTouched({ version: true, minimumVersion: true, url: true, sha256: true, signature: true, title: true, summary: true, changelog: true })
        const first = Object.values(fieldErrors(d))[0]
        if (first) throw new Error(first)
        await post('/v1/admin/releases', { ...d, version: d.version.trim(), minimumVersion: d.minimumVersion.trim(), url: d.url.trim(), sha256: d.sha256.trim(), signature: d.signature.trim() })
        notify(`已发布 ${d.version.trim()}`, 'success')
        onDone()
        onClose()
      }}>
      <FormSection>
        <FormField label="版本号" htmlFor="rl-version" required {...shown('version')}>
          <Input id="rl-version" mono value={d.version} placeholder="1.10.12" onBlur={blur('version')} onChange={(e) => set({ version: e.target.value })} />
        </FormField>
        <FormField label="最低版本" htmlFor="rl-min" required hint="低于它的客户端强制升级" {...shown('minimumVersion')}>
          <Input id="rl-min" mono value={d.minimumVersion} placeholder="1.9.0" onBlur={blur('minimumVersion')} onChange={(e) => set({ minimumVersion: e.target.value })} />
        </FormField>
        <FormField label="渠道" htmlFor="rl-channel">
          <SegmentedControl label="渠道" value={d.channel} onValueChange={(channel) => set({ channel })} options={[{ value: 'stable', label: '正式版' }, { value: 'beta', label: '测试版' }]} />
        </FormField>
        <FormField label="强制更新" htmlFor="rl-mandatory">
          <Switch id="rl-mandatory" checked={d.mandatory} onCheckedChange={(mandatory) => set({ mandatory })} />
        </FormField>
        <FormField label="下载地址" htmlFor="rl-url" required full {...shown('url')}>
          <Input id="rl-url" mono value={d.url} placeholder="https://…/ProxySplit-1.10.12.exe" onBlur={blur('url')} onChange={(e) => set({ url: e.target.value })} />
        </FormField>
        <FormField label="SHA-256" htmlFor="rl-sha" required full {...shown('sha256')}>
          <Input id="rl-sha" mono value={d.sha256} onBlur={blur('sha256')} onChange={(e) => set({ sha256: e.target.value.trim().toLowerCase() })} />
        </FormField>
        <FormField label="签名" htmlFor="rl-sig" required full {...shown('signature')}>
          <Textarea id="rl-sig" value={d.signature} rows={2} onBlur={blur('signature')} onChange={(e) => set({ signature: e.target.value })} />
        </FormField>
        <FormField label="标题" htmlFor="rl-title" optional full count={{ value: d.title.length, max: 120 }} {...shown('title')}>
          <Input id="rl-title" value={d.title} maxLength={120} onBlur={blur('title')} onChange={(e) => set({ title: e.target.value })} />
        </FormField>
        <FormField label="摘要" htmlFor="rl-summary" optional full count={{ value: d.summary.length, max: 500 }} {...shown('summary')}>
          <Input id="rl-summary" value={d.summary} maxLength={500} onBlur={blur('summary')} onChange={(e) => set({ summary: e.target.value })} />
        </FormField>
        <FormField label="更新日志" htmlFor="rl-log" optional full count={{ value: d.changelog.length, max: 20000 }} {...shown('changelog')}>
          <Textarea id="rl-log" value={d.changelog} rows={8} maxLength={20000} onBlur={blur('changelog')} onChange={(e) => set({ changelog: e.target.value })} />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}
