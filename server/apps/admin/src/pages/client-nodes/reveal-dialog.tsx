// 超管查看节点链接 / 订阅地址：打开时才请求解密（服务端每次记审计）。
import * as React from 'react'
import { CopyField, Dialog, InlineAlert, StatePanel, errorText } from '@ankotti/admin-ui'
import { post } from '@/lib/api'
import type { RevealTarget } from './shared'

export function RevealDialog({ target, onClose }: { target: RevealTarget | null; onClose: () => void }) {
  const [value, setValue] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    setValue(null)
    setError('')
    if (!target) return
    let alive = true
    const req = target.kind === 'node'
      ? post<{ link: string | null }>('/v1/admin/client-nodes/reveal', { deviceId: target.deviceId, nodeId: target.id }).then((r) => r.link)
      : post<{ url: string | null }>('/v1/admin/client-subs/reveal', { deviceId: target.deviceId, subId: target.id }).then((r) => r.url)
    req.then((v) => { if (alive) setValue(v ?? '') }, (e: unknown) => { if (alive) setError(errorText(e, '解密失败')) })
    return () => { alive = false }
  }, [target])
  const label = target?.kind === 'sub' ? '订阅地址' : '节点链接'
  return (
    <Dialog open={!!target} onClose={onClose} size="md" title={`${label}：${target?.name ?? ''}`} description="这次查看已记入审计日志。">
      {error ? (
        <InlineAlert tone="error" title="查看失败">{error}</InlineAlert>
      ) : value === null ? (
        <StatePanel kind="loading" title="正在解密" />
      ) : value === '' ? (
        <StatePanel kind="empty" title="没有保存链接" message="官方线路，或服务器没配加密密钥。" />
      ) : (
        <CopyField value={value} label={label} note="已记入审计" />
      )}
    </Dialog>
  )
}
