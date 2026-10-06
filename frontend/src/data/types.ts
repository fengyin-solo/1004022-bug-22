/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 行版本号：每次落库 +1，提交时做 CAS 乐观锁，多人并发时先落库的成功、后到的冲突。 */
  rev?: number
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

/** 业务拦截码：BLOCKED 规则不允许（可解释原因），CONFLICT 数据已被他人先更新（刷新后重试）。 */
export type ActionCode = 'BLOCKED' | 'CONFLICT' | 'NOT_FOUND'

export type ActionResult = {
  ok: boolean
  message: string
  code?: ActionCode
  /** 冲突时服务端当前最新行，页面据此回到与库一致的可操作状态。 */
  current?: EntryRow
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
