import { MODULE_BY_KEY } from '@/data/modules'
import { filterRows, moduleMeta } from '@/api/local-service'
import { allRows, listRows, saveAll } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'
import { networkCall } from '@/api/chaos'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export const PIPELINE_KEY = 'pipeline'
export const INSPECTION_KEY = 'inspection'
export const DEFECT_KEY = 'defect'
const PIPELINE_STOPPED = '已停用'
const PIPELINE_CODE_FIELD = '管线编号'
const PIPELINE_STOP_DATE_FIELD = '停用日期'

export type PipelineOption = { code: string; status: string }

export type PipelineDetail = {
  pipeline: EntryRow
  inspections: EntryRow[]
  defects: EntryRow[]
}

// 所有写操作串成一个队列：同一份数据同一时刻只有一个提交在落库，
// 先落库的成功，后到的靠 rev 乐观锁识别成冲突，回到可操作状态。
let writeTail: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const run = writeTail.then(task, task)
  // 队列本身不能因为某次失败而中断：吞掉拒绝，让后续提交照常排队。
  writeTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function fetchPage(key: string, filters: Record<string, string> = {}): Promise<PageResult> {
  return networkCall(() => {
    const matched = filterRows(listRows(key), filters)
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  })
}

/** 不加筛选条件的全量分页：状态图例、统计卡用它，避免筛选后图例跟着变成 0 误导人。 */
export function fetchAll(key: string): Promise<PageResult> {
  return fetchPage(key, {})
}

export function fetchPipelineDetail(id: number): Promise<PipelineDetail> {
  return networkCall(() => {
    const pipeline = listRows(PIPELINE_KEY).find((row) => Number(row.id) === id)
    if (!pipeline) {
      throw new Error(`没有找到编号为 ${id} 的管线`)
    }
    const code = String(pipeline[PIPELINE_CODE_FIELD] ?? '')
    return {
      pipeline,
      inspections: listRows(INSPECTION_KEY).filter((row) => String(row['关联管线'] ?? '') === code),
      defects: listRows(DEFECT_KEY).filter((row) => String(row['所属管线'] ?? '') === code),
    }
  })
}

export function fetchPipelineOptions(): Promise<PipelineOption[]> {
  return networkCall(() =>
    listRows(PIPELINE_KEY).map((row) => ({
      code: String(row[PIPELINE_CODE_FIELD] ?? ''),
      status: String(row.status ?? ''),
    })),
  )
}

/** 同步读取停用管线编号集合：工作台每次刷新后调用，用来在行内禁用「分配任务」。 */
export function listStoppedPipelineCodes(): Set<string> {
  return new Set(
    listRows(PIPELINE_KEY)
      .filter((row) => String(row.status) === PIPELINE_STOPPED)
      .map((row) => String(row[PIPELINE_CODE_FIELD] ?? '')),
  )
}

function isStopped(pipeline: EntryRow | undefined): boolean {
  return Boolean(pipeline) && String(pipeline!.status) === PIPELINE_STOPPED
}

function stoppedReason(pipeline: EntryRow): string {
  const date = pipeline[PIPELINE_STOP_DATE_FIELD]
  return date ? `已于${date}停用` : '已停用'
}

function findPipelineByCode(rows: EntryRow[], code: string): EntryRow | undefined {
  return rows.find((row) => String(row[PIPELINE_CODE_FIELD] ?? '') === code)
}

/**
 * 业务闸门：在「写事务内、读最新数据」之后再判定，避免先查后写之间管线被别人停用。
 * 返回拦截原因；为空表示放行。
 */
function blockReason(key: string, action: string, target: EntryRow): string {
  const pipelines = listRows(PIPELINE_KEY)

  if (key === PIPELINE_KEY) {
    if (String(target.status) === PIPELINE_STOPPED && action !== '停用管线') {
      return `该管线${stoppedReason(target)}，停用后仅支持查看，不能再执行「${action}」`
    }
    return ''
  }

  if (key === DEFECT_KEY) {
    const code = String(target['所属管线'] ?? '')
    const pipeline = findPipelineByCode(pipelines, code)
    if (isStopped(pipeline)) {
      return `管线${code}${stoppedReason(pipeline!)}：停用管线只允许查看，缺陷「${action}」已被拦截。历史缺陷记录仍保留，可继续查看`
    }
    return ''
  }

  if (key === INSPECTION_KEY && action === '分配任务') {
    const code = String(target['关联管线'] ?? '')
    const pipeline = findPipelineByCode(pipelines, code)
    if (isStopped(pipeline)) {
      return `管线${code}${stoppedReason(pipeline!)}，不能再向该管线下达新的巡检任务，本次「分配任务」已拦截`
    }
  }

  return ''
}

type CommitRequest = {
  key: string
  id: number
  action: string
  expectedRev: number
}

function commitSync({ key, id, action, expectedRev }: CommitRequest): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, code: 'BLOCKED', message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = [...listRows(key)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, code: 'NOT_FOUND', message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]

  // CAS：页面拿着的是 expectedRev，落库时版本对不上说明已被他人抢先更新。
  if (Number(current.rev ?? 1) !== expectedRev) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: `该${meta.entity}刚被其他值班人更新（当前状态「${current.status}」），本次「${action}」未提交，请按最新结果重试`,
      current: { ...current },
    }
  }

  if (String(current.status) === target) {
    return { ok: false, code: 'BLOCKED', message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const reason = blockReason(key, action, current)
  if (reason) {
    return { ok: false, code: 'BLOCKED', message: reason, current: { ...current } }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === PIPELINE_KEY && action === '停用管线') {
    updated[PIPELINE_STOP_DATE_FIELD] = today()
  }
  updated.rev = Number(current.rev ?? 1) + 1
  rows[index] = updated
  saveAll({ [key]: rows })
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 提交动作：网络层模拟失败时数据不会被触碰；成功落库才推进 rev。 */
export function commitAction(
  key: string,
  id: number,
  action: string,
  expectedRev: number,
): Promise<ActionResult> {
  return enqueue(() => networkCall(() => commitSync({ key, id, action, expectedRev })))
}

export type NewDraft = {
  key: string
  values: Record<string, string>
}

function nextCode(prefix: string, field: string, rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const text = String(row[field] ?? '')
    const match = /(\d+)\s*$/.exec(text)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

function validatePipelineRef(code: string): { ok: true; pipeline: EntryRow } | { ok: false; message: string } {
  const pipeline = findPipelineByCode(listRows(PIPELINE_KEY), code)
  if (!pipeline) {
    return { ok: false, message: `管线编号「${code}」不存在，请先在管线登记中建档后再提交` }
  }
  if (isStopped(pipeline)) {
    return {
      ok: false,
      message: `管线${code}${stoppedReason(pipeline)}，停用管线上不允许登记新记录，本次提交已拦截`,
    }
  }
  return { ok: true, pipeline }
}

function createSync({ key, values }: NewDraft): ActionResult {
  const meta = moduleMeta(key)
  const rows = [...listRows(key)]

  // 再次校验关联管线：提交落库的瞬间仍可能刚好被别人停用，必须在写事务内判定。
  let refCode = ''
  if (key === DEFECT_KEY) {
    refCode = String(values['所属管线'] ?? '').trim()
    const check = validatePipelineRef(refCode)
    if (!check.ok) {
      return { ok: false, code: 'BLOCKED', message: check.message }
    }
  } else if (key === INSPECTION_KEY) {
    refCode = String(values['关联管线'] ?? '').trim()
    const check = validatePipelineRef(refCode)
    if (!check.ok) {
      return { ok: false, code: 'BLOCKED', message: check.message }
    }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const firstStatus = meta.statuses[0]
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const row: EntryRow = {
    id,
    status: firstStatus,
    pending: firstStatus !== lastStatus,
    abnormal: false,
    rev: 1,
  }
  for (const field of meta.fields) {
    row[field] = (values[field] ?? '').trim()
  }

  if (key === DEFECT_KEY) {
    row['缺陷编号'] = nextCode('DEFE', '缺陷编号', rows)
    row['记录状态'] = '新建待确认'
  } else if (key === INSPECTION_KEY) {
    row['任务编号'] = nextCode('INSP', '任务编号', rows)
    row['完成情况'] = '未开始'
  }

  rows.push(row)
  saveAll({ [key]: rows })
  return { ok: true, message: `${meta.entity}已登记，编号${row[meta.fields[0]] ?? id}，当前状态「${firstStatus}」` }
}

export function createEntry(key: string, values: Record<string, string>): Promise<ActionResult> {
  return enqueue(() => networkCall(() => createSync({ key, values })))
}

/** 供看板等同步页面使用：当前缓存里各状态数量。 */
export function statusBreakdown(key: string): { status: string; count: number }[] {
  const meta = MODULE_BY_KEY.get(key)
  const rows = allRows()[key] ?? []
  return (meta?.statuses ?? []).map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
}
