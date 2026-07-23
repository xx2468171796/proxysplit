import { useEffect, useState } from 'react'
import { Activity, Boxes, KeyRound, LayoutDashboard, LogOut, Monitor, PackageOpen, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import { api, hasToken, login, setToken } from './api'

type Page = 'dashboard' | 'users' | 'devices' | 'releases' | 'audit'
type AnyRow = Record<string, any>
const pageMeta: Record<Page, [string, string]> = {
  dashboard: ['运营概览', '用户、授权与设备健康状态'],
  users: ['用户与授权', '创建账号、续费、暂停与封禁'],
  devices: ['设备管理', '设备在线状态、解绑与强制下线'],
  releases: ['版本发布', '客户端版本、强制升级与校验信息'],
  audit: ['审计日志', '管理员关键操作与结果追踪'],
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('admin'), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await login(username, password); onDone() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <main className="login"><form className="login-card" onSubmit={submit}><div className="login-mark"><ShieldCheck /></div><h1>ProxySplit</h1><p>商业运营管理后台</p><label>用户名<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label><label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="error">{error}</div>}<button disabled={busy}>{busy ? '登录中…' : '登录后台'}</button></form></main>
}

function Dashboard() {
  const [data, setData] = useState<AnyRow | null>(null)
  useEffect(() => { api<AnyRow>('/v1/admin/dashboard').then(setData).catch(() => setData({})) }, [])
  const cards = [['用户总数', data?.users ?? '—', Users], ['有效授权', data?.licenses ?? '—', KeyRound], ['在线设备', data?.online ?? '—', Monitor], ['7 天内到期', data?.expiring ?? '—', Activity]] as const
  return <><div className="kpis">{cards.map(([name, value, Icon]) => <article className="kpi" key={name}><span><Icon /></span><div><small>{name}</small><strong>{value}</strong></div></article>)}</div><section className="card welcome"><div><h2>商业服务运行概况</h2><p>客户端授权采用短期 Ed25519 签名租约，服务端掌握最终授权判定。</p></div><span className="healthy">● 服务正常</span></section></>
}

function UsersPage() {
  const [rows, setRows] = useState<AnyRow[]>([]), [show, setShow] = useState(false), [form, setForm] = useState({ username: '', password: '', days: 30 })
  const load = () => api<{ items: AnyRow[] }>('/v1/admin/users').then(x => setRows(x.items)); useEffect(() => { load() }, [])
  async function create(e: React.FormEvent) { e.preventDefault(); await api('/v1/admin/users', { method: 'POST', body: JSON.stringify(form) }); setShow(false); setForm({ username: '', password: '', days: 30 }); load() }
  async function status(id: string, value: string) { await api(`/v1/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: value }) }); load() }
  async function extend(id: string) { await api(`/v1/admin/users/${id}/extend`, { method: 'POST', body: JSON.stringify({ days: 30 }) }); load() }
  return <section className="card"><div className="card-head"><div><b>用户列表</b><small>共 {rows.length} 个账号</small></div><button className="primary" onClick={() => setShow(!show)}>+ 创建用户</button></div>{show && <form className="inline-form" onSubmit={create}><input placeholder="用户名" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /><input placeholder="初始密码（至少 10 位）" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /><input type="number" min="1" value={form.days} onChange={e => setForm({ ...form, days: Number(e.target.value) })} /><button>创建并开通</button></form>}<div className="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>套餐 / 到期</th><th>设备</th><th>状态</th><th></th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><b>{r.username}</b><small>{new Date(r.createdAt).toLocaleDateString()}</small></td><td>{r.role}</td><td>{r.planName || '—'}<small>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '未开通'}</small></td><td>{r.devices}</td><td><span className={'pill ' + r.status}>{r.status}</span></td><td className="actions"><button onClick={() => extend(r.id)}>续费 30 天</button><button onClick={() => status(r.id, r.status === 'active' ? 'suspended' : 'active')}>{r.status === 'active' ? '暂停' : '恢复'}</button></td></tr>)}</tbody></table></div></section>
}

function DevicesPage() {
  const [rows, setRows] = useState<AnyRow[]>([]); const load = () => api<{ items: AnyRow[] }>('/v1/admin/devices').then(x => setRows(x.items)); useEffect(() => { load() }, [])
  async function revoke(id: string) { if (!confirm('确认解绑该设备并吊销相关会话？')) return; await api(`/v1/admin/devices/${id}`, { method: 'DELETE' }); load() }
  return <section className="card"><div className="card-head"><div><b>已绑定设备</b><small>解绑后客户端需要重新登录并占用新设备名额</small></div></div><div className="table-wrap"><table><thead><tr><th>用户 / 设备</th><th>平台</th><th>版本</th><th>最后在线</th><th>状态</th><th></th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><b>{r.username}</b><small>{r.name}</small></td><td>{r.platform}</td><td>{r.appVersion}</td><td>{new Date(r.lastSeenAt).toLocaleString()}</td><td><span className={'pill ' + (r.revoked ? 'banned' : 'active')}>{r.revoked ? '已解绑' : '正常'}</span></td><td className="actions"><button disabled={r.revoked} onClick={() => revoke(r.id)}>解绑</button></td></tr>)}</tbody></table></div></section>
}

function ReleasesPage() {
  const [rows, setRows] = useState<AnyRow[]>([]), [show, setShow] = useState(false), [form, setForm] = useState({ version: '', minimumVersion: '', url: '', sha256: '', signature: '', mandatory: false })
  const load = () => api<{ items: AnyRow[] }>('/v1/admin/releases').then(x => setRows(x.items)); useEffect(() => { load() }, [])
  async function create(e: React.FormEvent) { e.preventDefault(); await api('/v1/admin/releases', { method: 'POST', body: JSON.stringify(form) }); setShow(false); load() }
  return <section className="card"><div className="card-head"><div><b>版本发布</b><small>发布清单必须包含 SHA256 与离线签名</small></div><button className="primary" onClick={() => setShow(!show)}>+ 新版本</button></div>{show && <form className="release-form" onSubmit={create}>{Object.entries(form).map(([k, v]) => k === 'mandatory' ? <label key={k}><input type="checkbox" checked={v as boolean} onChange={e => setForm({ ...form, mandatory: e.target.checked })} /> 强制升级</label> : <input key={k} placeholder={k} value={v as string} onChange={e => setForm({ ...form, [k]: e.target.value })} />)}<button>发布</button></form>}<div className="table-wrap"><table><thead><tr><th>版本</th><th>最低版本</th><th>下载地址</th><th>SHA256</th><th>发布于</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><b>v{r.version}</b>{r.mandatory && <small className="danger">强制升级</small>}</td><td>{r.minimumVersion}</td><td className="clip">{r.url}</td><td className="mono">{r.sha256.slice(0, 16)}…</td><td>{new Date(r.publishedAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
}

function AuditPage() { const [rows, setRows] = useState<AnyRow[]>([]); useEffect(() => { api<{ items: AnyRow[] }>('/v1/admin/audit').then(x => setRows(x.items)) }, []); return <section className="card"><div className="card-head"><div><b>审计日志</b><small>不记录密码、完整令牌与设备原始指纹</small></div></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>动作</th><th>对象</th><th>来源 IP</th><th>结果</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleString()}</td><td>{r.actor || '系统'}</td><td className="mono">{r.action}</td><td>{r.targetType}:{r.targetId.slice(0, 8)}</td><td>{r.ip || '—'}</td><td><span className="pill active">{r.result}</span></td></tr>)}</tbody></table></div></section> }

export function App() {
  const [signed, setSigned] = useState(hasToken()), [page, setPage] = useState<Page>('dashboard'), [query, setQuery] = useState('')
  if (!signed) return <Login onDone={() => setSigned(true)} />
  const nav = [['dashboard', LayoutDashboard, '概览'], ['users', Users, '用户与授权'], ['devices', Monitor, '设备'], ['releases', PackageOpen, '版本'], ['audit', Activity, '审计']] as const
  return <div className="shell"><aside><div className="brand"><span><Boxes /></span><div><b>ProxySplit</b><small>COMMERCIAL CONSOLE</small></div></div><nav>{nav.map(([id, Icon, label]) => <button className={page === id ? 'active' : ''} onClick={() => setPage(id)} key={id}><Icon />{label}</button>)}</nav><div className="side-foot"><div><ShieldCheck />安全运营模式</div><button onClick={() => { setToken(''); setSigned(false) }}><LogOut />退出登录</button></div></aside><main><header><div><h1>{pageMeta[page][0]}</h1><p>{pageMeta[page][1]}</p></div><div className="header-actions"><label><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索…" /></label><button title="刷新页面" onClick={() => location.reload()}><RefreshCw /></button><span className="admin">AD</span></div></header><div className="content">{page === 'dashboard' ? <Dashboard /> : page === 'users' ? <UsersPage /> : page === 'devices' ? <DevicesPage /> : page === 'releases' ? <ReleasesPage /> : <AuditPage />}</div></main></div>
}
