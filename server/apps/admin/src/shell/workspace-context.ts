// 工作标签上下文：页面之间跳转（打开某页并带参数、打开用户详情标签）只走这里，不直接改地址栏。
import * as React from 'react'

export type PageParams = Record<string, string>

export type WorkspaceApi = {
  /** 打开（或切到）一个菜单页；params 交给页面（例如分销页的初始搜索词）。 */
  openPage: (id: string, params?: PageParams) => void
  /** 用户详情作为工作标签打开（标题 = 用户名）。 */
  openUser: (userId: string, username: string) => void
  close: (tabId: string) => void
  /** 工作标签改名（地址栏直接打开用户详情时，加载完换成用户名）。 */
  rename: (tabId: string, title: string) => void
}

export const WorkspaceContext = React.createContext<WorkspaceApi>({
  openPage: () => undefined,
  openUser: () => undefined,
  close: () => undefined,
  rename: () => undefined,
})

export const useWorkspace = () => React.useContext(WorkspaceContext)

/** 每个菜单页拿到的属性：active = 当前可见（隐藏时暂停轮询）；params = 打开时带的参数。 */
export type PageProps = { active: boolean; params?: PageParams | undefined }
