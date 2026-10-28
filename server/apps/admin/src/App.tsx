// 登录门 + 外壳。登录页用 AuthLayout + LoginForm（按钮一直能点，错误给人话）。
import * as React from 'react'
import { AuthLayout, LoginForm, errorText } from '@ankotti/admin-ui'
import { hasToken, login } from '@/lib/api'
import { Workspace } from '@/shell/workspace'

const USER_KEY = 'ps-admin-user'

export function App() {
  const [signed, setSigned] = React.useState(hasToken())
  const [username, setUsername] = React.useState(() => sessionStorage.getItem(USER_KEY) ?? '管理员')

  if (signed) return <Workspace username={username} />
  return (
    <AuthLayout logo="P" title="ProxySplit 运营后台" description="管理员账号登录">
      <LoginForm
        accountLabel="用户名"
        accountPlaceholder="管理员用户名"
        submitLabel="登录"
        errorMessage={(e) => errorText(e, '登录失败，请稍后再试')}
        onSubmit={async ({ account, password }) => {
          if (!account.trim() || !password) throw new Error('请填写用户名和密码')
          await login(account.trim(), password)
          sessionStorage.setItem(USER_KEY, account.trim())
          setUsername(account.trim())
          setSigned(true)
        }}
      />
    </AuthLayout>
  )
}
