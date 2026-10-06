import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveAll, syncFromStorage } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const PIPELINE_KEY = 'pipeline'
const PIPELINE_DISABLED_STATUS = '已停用'

// 跨模块约束：管线停用后，关联模块里「产生新工作」的动作要被拦截并说明原因。
// 历史记录（已确认的缺陷、已分配的任务）不受影响，仍可按原流程走完。
// 这些动作落库时会联动把管线版本 +1：另一端若正基于旧快照停用该管线，
// 会因版本冲突被拦下，实现「先落库者胜，另一个回到可操作状态」。
const PIPELINE_LINK_GUARDS: Record<string, Record<string, { field: string; verb: string }>> = {
  defect: {
    确认缺陷: { field: '所属管线', verb: '确认新缺陷' },
  },
  inspection: {
    分配任务: { field: '巡检路线', verb: '分配新巡检任务' },
  },
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  // 每次列表都先对齐落库内容：读取失败会抛 StorageError，
  // 由页面捕获后保留上次结果并给出重试入口，不能把空数据当成无记录。
  syncFromStorage()
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function rowVersion(row: EntryRow): number {
  return Number(row.version ?? 0)
}

function storageFailure(error: unknown): ActionResult {
  return {
    ok: false,
    code: 'error',
    message: error instanceof Error ? error.message : '本地数据读写失败，请重试',
  }
}

export function runAction(key: string, id: number, action: string, expectedVersion?: number): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, code: 'error', message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 判定一律基于最新落库内容：多人同时操作时，先落库者胜。
  let store: Record<string, EntryRow[]>
  try {
    syncFromStorage()
    store = allRows()
  } catch (error) {
    return storageFailure(error)
  }
  const rows = store[key] ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, code: 'error', message: `没有找到编号为 ${id} 的${meta.entity}，可能已被其他人移除，请刷新列表` }
  }
  const current = rows[index]
  const currentVersion = rowVersion(current)
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    return {
      ok: false,
      code: 'conflict',
      message: `这条${meta.entity}刚被其他人更新，已刷新到最新状态，请确认后再操作`,
    }
  }
  const currentStatus = String(current.status)
  // 管线停用后只能查看：任何动作都不再接受，历史列表保留。
  if (key === PIPELINE_KEY && currentStatus === PIPELINE_DISABLED_STATUS) {
    return { ok: false, code: 'blocked', message: `管线已停用，仅可查看历史记录，不能再执行「${action}」` }
  }
  if (currentStatus === target) {
    return { ok: false, code: 'error', message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 关联管线已停用时，拦截新的缺陷确认与巡检分配，并说明原因。
  const guard = PIPELINE_LINK_GUARDS[key]?.[action]
  let pipelineRows: EntryRow[] | null = null
  let pipelineIndex = -1
  if (guard) {
    const ref = String(current[guard.field] ?? '').trim()
    const pipelines = store[PIPELINE_KEY] ?? []
    pipelineIndex = pipelines.findIndex((pipeline) => {
      const code = String(pipeline['管线编号'] ?? '').trim()
      return code !== '' && ref.includes(code)
    })
    if (pipelineIndex >= 0) {
      const linked = pipelines[pipelineIndex]
      if (String(linked.status) === PIPELINE_DISABLED_STATUS) {
        return {
          ok: false,
          code: 'blocked',
          message: `${guard.field}关联的管线「${String(linked['管线编号'])}」已停用，不能${guard.verb}；历史记录保留，本条记录仍可查看或改作其他处理`,
        }
      }
      pipelineRows = pipelines
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    version: currentVersion + 1,
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  const nextStore: Record<string, EntryRow[]> = { ...store, [key]: nextRows }
  if (pipelineRows && pipelineIndex >= 0) {
    // 新缺陷/新巡检落库时联动管线版本 +1：基于旧快照的「停用管线」会因此冲突，
    // 停用方刷新后可继续处理，不会把先落库的缺陷/巡检冲掉。
    const linked = pipelineRows[pipelineIndex]
    const bumped = [...pipelineRows]
    bumped[pipelineIndex] = { ...linked, version: rowVersion(linked) + 1 }
    nextStore[PIPELINE_KEY] = bumped
  }
  try {
    saveAll(nextStore)
  } catch (error) {
    return storageFailure(error)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
