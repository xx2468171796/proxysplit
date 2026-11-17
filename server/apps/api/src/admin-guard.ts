// 后台权限的一处闸门：普通管理员能管普通用户；动管理员账号（含超管）或新建管理员，必须是超级管理员。
// 超级管理员 = 角色 admin 且用户名在 SUPER_ADMIN_USERNAMES 里（默认 admin）。
// 没有这道闸时，任何一个管理员都能重置超管密码、把自己人建成管理员 —— 等于人人都是超管。
import { AppError } from '@proxysplit/shared'

export type AdminPrincipal = { userId: string; role: string }
type GuardUser = { username: string; role: string }
export type AdminGuardDeps = {
  findUser: (id: string) => Promise<GuardUser | null>
  /** 逗号分隔的超管用户名；不配 = admin。 */
  superAdminUsernames: string | undefined
}

const superRequired = () => new AppError('SUPER_ADMIN_REQUIRED', '只有超级管理员能操作管理员账号', 403)

export function createAdminGuard(d: AdminGuardDeps) {
  const parse = (list: string) => list.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  // 没配、配成空串或全是空白 = 默认 admin：名单为空的话没有任何人能管理管理员账号。
  const configured = parse(d.superAdminUsernames ?? '')
  const names = new Set(configured.length ? configured : ['admin'])
  const isSuperAdmin = async (p: AdminPrincipal) => {
    if (p.role !== 'admin') return false
    const u = await d.findUser(p.userId)
    return !!u && names.has(u.username.toLowerCase())
  }
  return {
    isSuperAdmin,
    /** 对某个用户做写操作：目标是管理员时要求超管。目标不存在不在这里报，交给后面的业务回 404。 */
    async mayActOn(p: AdminPrincipal, targetUserId: string): Promise<void> {
      const target = await d.findUser(targetUserId)
      if (target?.role === 'admin' && !await isSuperAdmin(p)) throw superRequired()
    },
    /** 新建账号：要建的是管理员时要求超管。 */
    async mayCreate(p: AdminPrincipal, role: string): Promise<void> {
      if (role === 'admin' && !await isSuperAdmin(p)) throw superRequired()
    },
  }
}
export type AdminGuard = ReturnType<typeof createAdminGuard>
