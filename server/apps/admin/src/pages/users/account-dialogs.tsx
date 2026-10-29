// 账号处置弹框（公司统一账号 zhanghao）：封禁（限时 / 永久 + 理由）、强制下线、改昵称。
// requestId 在弹框打开时生成一次，网络重试时复用，服务端据此只生效一次。
import * as React from 'react'
import { FormDialog, FormField, FormSection, Input, SegmentedControl, Textarea } from '@ankotti/admin-ui'
import { post } from '@/lib/api'

type Target = { id: string; username: string }
type Props = { user: Target; onClose: () => void; onDone: () => void }
const useRequestId = () => React.useState(() => crypto.randomUUID())[0]

const BAN_DAYS = [{ value: '1', label: '1 天' }, { value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: 'forever', label: '永久' }]

export function BanDialog({ user, onClose, onDone }: Props) {
  const requestId = useRequestId()
  const [days, setDays] = React.useState('7')
  const [reason, setReason] = React.useState('')
  return (
    <FormDialog open title={`封禁「${user.username}」`} description="封禁后该用户在所有设备上立即下线，期间不能登录；限时封禁到期自动解除。"
      submitLabel="封禁" dirty={!!reason} onClose={onClose}
      onSubmit={async () => {
        if (!reason.trim()) throw new Error('请填写封禁理由')
        await post(`/v1/admin/users/${user.id}/ban`, { days: days === 'forever' ? null : Number(days), reason: reason.trim(), requestId })
        onDone()
      }}>
      <FormSection>
        <FormField label="时长" htmlFor="ban-days" full><SegmentedControl label="封禁时长" value={days} options={BAN_DAYS} onValueChange={setDays} /></FormField>
        <FormField label="理由" htmlFor="ban-reason" required full hint="写进操作记录，用户登录时不会看到原文">
          <Textarea id="ban-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}

/** 解封 / 强制下线：只要一句理由 */
export function ReasonDialog({ user, kind, onClose, onDone }: Props & { kind: 'unban' | 'revoke' }) {
  const requestId = useRequestId()
  const [reason, setReason] = React.useState('')
  const unban = kind === 'unban'
  return (
    <FormDialog open title={unban ? `解封「${user.username}」` : `让「${user.username}」强制下线`}
      description={unban ? '解封后用户可以马上重新登录。' : '该用户所有设备的登录立即失效，需要重新登录；账号本身不受影响。'}
      submitLabel={unban ? '解封' : '强制下线'} dirty={!!reason} onClose={onClose}
      onSubmit={async () => {
        if (!reason.trim()) throw new Error('请填写理由')
        await post(`/v1/admin/users/${user.id}/${unban ? 'unban' : 'revoke-sessions'}`, { reason: reason.trim(), requestId })
        onDone()
      }}>
      <FormField label="理由" htmlFor="rs-reason" required full>
        <Textarea id="rs-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}

export function NicknameDialog({ user, current, onClose, onDone }: Props & { current: string | null }) {
  const requestId = useRequestId()
  const [nickname, setNickname] = React.useState(current ?? '')
  return (
    <FormDialog open title={`修改「${user.username}」的昵称`} description="留空 = 显示用户名。昵称按公司统一规范检查（不含手机号、不含骂人词）。"
      submitLabel="保存" dirty={nickname !== (current ?? '')} onClose={onClose}
      onSubmit={async () => {
        await post(`/v1/admin/users/${user.id}/nickname`, { nickname: nickname.trim() || null, requestId })
        onDone()
      }}>
      <FormField label="昵称" htmlFor="nk-name" full><Input id="nk-name" value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} /></FormField>
    </FormDialog>
  )
}
