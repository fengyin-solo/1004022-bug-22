/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 乐观并发版本号：每次落库 +1，老数据没有该字段时按 0 处理。 */
  version?: number
  [field: string]: string | number | boolean | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /**
   * 失败分类：
   * - conflict：版本冲突，别人先落库了，页面应刷新到最新状态后再操作；
   * - blocked：业务拦截（如管线已停用），记录保持原状态可继续处理；
   * - error：参数或存储层错误。
   */
  code?: 'conflict' | 'blocked' | 'error'
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
