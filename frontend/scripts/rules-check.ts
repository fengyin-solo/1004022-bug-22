/* 核心业务规则测试：内存版 window/localStorage，模拟多人并发。 */
const storeMap = new Map<string, string>()

class LocalStorageMock {
  getItem(key: string): string | null {
    return storeMap.has(key) ? storeMap.get(key)! : null
  }
  setItem(key: string, value: string): void {
    storeMap.set(key, value)
  }
  removeItem(key: string): void {
    storeMap.delete(key)
  }
}

const listeners: { type: string; fn: EventListener }[] = []
;(globalThis as any).window = globalThis
;(globalThis as any).localStorage = new LocalStorageMock()
;(globalThis as any).CustomEvent = class CustomEvent extends Event {
  detail?: unknown
}
globalThis.addEventListener = ((type: string, fn: EventListener) => {
  listeners.push({ type, fn })
}) as any
globalThis.removeEventListener = (() => {}) as any
globalThis.dispatchEvent = ((event: Event) => {
  for (const item of listeners) if (item.type === event.type) item.fn(event)
  return true
}) as any

import {
  commitAction,
  createEntry,
  fetchPage,
  fetchPipelineOptions,
} from '../src/api/core-service'
import { toggleChaos } from '../src/api/chaos'
import { listRows } from '../src/data/local-store'

let failures = 0
function assert(condition: unknown, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`)
  } else {
    failures += 1
    console.error(`  ❌ ${label}`)
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('1. 初始数据：存在已停用管线 PIPE-0004，且有遗留待确认缺陷 DEFE-0004')
  const defectStopped = listRows('defect').find((r) => r['缺陷编号'] === 'DEFE-0004')
  assert(defectStopped?.status === '待确认', '遗留缺陷仍保留在历史列表')

  console.log('2. 停用管线上确认缺陷必须被拦截并说明原因')
  const blocked = await commitAction('defect', Number(defectStopped!.id), '确认缺陷', Number(defectStopped!.rev ?? 1))
  assert(!blocked.ok && blocked.code === 'BLOCKED', '确认缺陷返回 BLOCKED')
  assert(/PIPE-0004.*停用/.test(blocked.message), '拦截信息包含管线与停用原因')
  assert(listRows('defect').find((r) => r.id === defectStopped!.id)?.status === '待确认', '缺陷状态未被改变，仍是待确认')

  console.log('3. 停用管线上分配巡检任务被拦截，执行中任务不受影响')
  const inspOnStopped = listRows('inspection').find((r) => r['关联管线'] === 'PIPE-0004')
  // 历史任务已完成，构造一个待分配任务指向停用管线来验证闸门
  const inspWaiting = listRows('inspection').find((r) => r.status === '待分配')!
  inspWaiting['关联管线'] = 'PIPE-0004'
  const assignBlocked = await commitAction('inspection', Number(inspWaiting.id), '分配任务', Number(inspWaiting.rev ?? 1))
  assert(!assignBlocked.ok && assignBlocked.code === 'BLOCKED', '分配任务到停用管线被拦截')
  inspWaiting['关联管线'] = 'PIPE-0002'

  console.log('4. 新建缺陷/巡检引用停用管线被拦截')
  const createBlocked = await createEntry('defect', {
    所属管线: 'PIPE-0004',
    缺陷类型: '渗漏',
    发现位置: 'x',
    严重等级: '一般',
    发现日期: '2026-10-06',
    缺陷描述: 'y',
  } as any)
  assert(!createBlocked.ok && createBlocked.code === 'BLOCKED', '停用管线上登记缺陷被拦截')

  console.log('5. 正常管线动作可以落库，rev 递增')
  const defect1 = listRows('defect').find((r) => r['缺陷编号'] === 'DEFE-0001')!
  const ok = await commitAction('defect', Number(defect1.id), '确认缺陷', Number(defect1.rev ?? 1))
  assert(ok.ok, '活动管线上确认缺陷成功')
  assert(listRows('defect').find((r) => r.id === defect1.id)?.rev === 2, '成功后 rev 递增到 2')

  console.log('6. 并发：两人同时确认同一缺陷，先落库者赢，后者 CONFLICT 且数据不变')
  // 先把缺陷1重置为待确认做竞态：用一条新的待确认缺陷
  await createEntry('defect', {
    所属管线: 'PIPE-0002',
    缺陷类型: '淤积',
    发现位置: 'z',
    严重等级: '一般',
    发现日期: '2026-10-06',
    缺陷描述: '竞态用',
  } as any)
  const raceRow = [...listRows('defect')].reverse().find((r) => r['缺陷描述'] === '竞态用')!
  const revBefore = Number(raceRow.rev ?? 1)
  const [a, b] = await Promise.all([
    commitAction('defect', Number(raceRow.id), '确认缺陷', revBefore),
    commitAction('defect', Number(raceRow.id), '确认缺陷', revBefore),
  ])
  const winner = a.ok ? a : b
  const loser = a.ok ? b : a
  assert(winner.ok, '先落库的一方成功')
  assert(!loser.ok && loser.code === 'CONFLICT', '后到的一方得到 CONFLICT')
  assert(Boolean(loser.current) && loser.current!.status === '已确认', '冲突响应带服务端最新行')
  assert(listRows('defect').find((r) => r.id === raceRow.id)?.rev === revBefore + 1, '只落库一次，rev 只 +1')

  console.log('7. 并发：一人停用管线、一人确认该管线缺陷，先停用则确认被拦截')
  // 在 PIPE-0002 上先准备一条待确认缺陷，再让「停用」与「确认」并发排队。
  await createEntry('defect', {
    所属管线: 'PIPE-0002',
    缺陷类型: '渗漏',
    发现位置: '竞态点',
    严重等级: '一般',
    发现日期: '2026-10-06',
    缺陷描述: '停用竞态用',
  } as Record<string, string>)
  const pipe2 = listRows('pipeline').find((r) => r['管线编号'] === 'PIPE-0002')!
  const defectOn2 = [...listRows('defect')].reverse().find(
    (r) => r['所属管线'] === 'PIPE-0002' && r.status === '待确认',
  )
  assert(Boolean(defectOn2), '存在 PIPE-0002 上的待确认缺陷用于竞态')
  const [stopResult, confirmResult] = await Promise.all([
    commitAction('pipeline', Number(pipe2.id), '停用管线', Number(pipe2.rev ?? 1)),
    commitAction('defect', Number(defectOn2!.id), '确认缺陷', Number(defectOn2!.rev ?? 1)),
  ])
  assert(stopResult.ok, '管线停用先落库成功')
  assert(!confirmResult.ok && confirmResult.code === 'BLOCKED', '随后确认缺陷被停用规则拦截')
  assert(listRows('pipeline').find((r) => r.id === pipe2.id)?.['停用日期'], '停用写入了停用日期')

  console.log('8. 网络失败：不改动任何数据，可原样重试成功')
  const pipe3 = listRows('pipeline').find((r) => r['管线编号'] === 'PIPE-0003')!
  const rev3 = Number(pipe3.rev ?? 1)
  toggleChaos(true)
  let networkFailed = false
  try {
    await commitAction('pipeline', Number(pipe3.id), '停用管线', rev3)
  } catch (e) {
    networkFailed = true
  }
  assert(networkFailed, '故障演练下提交抛网络错误')
  assert(listRows('pipeline').find((r) => r.id === pipe3.id)?.rev === rev3, '失败后 rev 不变，数据未改动')
  toggleChaos(false)
  const retry = await commitAction('pipeline', Number(pipe3.id), '停用管线', rev3)
  assert(retry.ok, '关闭故障后原样重试成功')

  console.log('9. 筛选：有结果=成功命中；无结果=空列表而非无记录（由 UI 层区分，服务返回空数组）')
  const hit = await fetchPage('defect', { 所属管线: 'PIPE-0004' })
  assert(hit.items.length >= 1, '按停用管线筛选仍能查到历史缺陷')
  const none = await fetchPage('defect', { 缺陷编号: 'NOT-EXIST' })
  assert(Array.isArray(none.items) && none.items.length === 0, '无命中返回空数组（与未加载/失败区分）')

  console.log('10. 管线选项包含停用标记，供新建表单禁用')
  const options = await fetchPipelineOptions()
  const opt4 = options.find((o) => o.code === 'PIPE-0004')
  assert(opt4?.status === '已停用', '选项能识别停用管线')

  if (failures > 0) {
    console.error(`\n${failures} 条断言失败`)
    process.exit(1)
  }
  console.log('\n全部规则断言通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
