/**
 * 服务层行为验证：管线停用约束、跨模块拦截、版本并发、失败保留。
 * 运行：npx esbuild tests/local-service.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/svc-test.mjs && node /tmp/svc-test.mjs
 */
import { listEntries, resetModule, runAction } from '@/api/local-service'
import { storageKey } from '@/data/local-store'

// ---- 浏览器环境模拟：内存版 localStorage（多标签页共享的就是它） ----
const memory = new Map<string, string>()
const store = {
  getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
}
;(globalThis as Record<string, unknown>).window = { localStorage: store }

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ok  ${name}`)
  } else {
    failed += 1
    console.error(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function fresh() {
  memory.clear()
  resetModule('pipeline')
  resetModule('inspection')
  resetModule('defect')
}

// 页面列表快照：模拟两个值班人员各自打开的页面（各自持有行版本号）
function snapshot(key: string) {
  return listEntries(key).items
}

// ---------- 场景 1：停用后只能查看，历史列表保留 ----------
fresh()
let r = runAction('pipeline', 2, '停用管线', 0)
check('停用管线成功', r.ok, r.message)
r = runAction('pipeline', 2, '提交建档', 1)
check('停用后提交建档被拦截', !r.ok && r.code === 'blocked', r.message)
check('拦截说明原因', r.message.includes('已停用') && r.message.includes('仅可查看'), r.message)
r = runAction('pipeline', 2, '停用管线', 1)
check('停用后再次停用也被拦截', !r.ok && r.code === 'blocked', r.message)
const all = listEntries('pipeline')
check('历史列表仍保留全部管线', all.total === 3 && all.items.some((x) => x.status === '已停用'))

// ---------- 场景 2：停用后确认新缺陷被拦截，缺陷保持可操作 ----------
fresh()
runAction('pipeline', 1, '停用管线', 0)
const defect1 = snapshot('defect').find((x) => x['所属管线'] === 'PIPE-0001')!
r = runAction('defect', Number(defect1.id), '确认缺陷', Number(defect1.version ?? 0))
check('停用管线的缺陷确认被拦截', !r.ok && r.code === 'blocked', r.message)
check('拦截消息含管线编号与原因', r.message.includes('PIPE-0001') && r.message.includes('已停用'), r.message)
const after = snapshot('defect').find((x) => Number(x.id) === Number(defect1.id))!
check('缺陷保持待确认可继续处理', after.status === '待确认', String(after.status))
r = runAction('defect', Number(after.id), '忽略缺陷', Number(after.version ?? 0))
check('被拦截的缺陷可改作忽略', r.ok, r.message)

// ---------- 场景 3：停用后分配巡检任务被拦截 ----------
fresh()
runAction('pipeline', 1, '停用管线', 0)
const task1 = snapshot('inspection').find((x) => String(x['巡检路线']).includes('PIPE-0001'))!
r = runAction('inspection', Number(task1.id), '分配任务', Number(task1.version ?? 0))
check('停用管线的巡检分配被拦截', !r.ok && r.code === 'blocked' && r.message.includes('PIPE-0001'), r.message)
check('任务保持待分配', snapshot('inspection').find((x) => Number(x.id) === Number(task1.id))!.status === '待分配')

// ---------- 场景 4：正常管线不受影响 ----------
fresh()
const okDefect = snapshot('defect').find((x) => x['所属管线'] === 'PIPE-0001')!
r = runAction('defect', Number(okDefect.id), '确认缺陷', Number(okDefect.version ?? 0))
check('在用管线的缺陷可正常确认', r.ok, r.message)

// ---------- 场景 5：先落库者胜（缺陷确认 vs 停用管线）----------
fresh()
// 甲打开管线页看到 PIPE-0001 版本 v0；乙先确认了该管线的缺陷
const pipeSnapshot = snapshot('pipeline').find((x) => x['管线编号'] === 'PIPE-0001')!
const d1 = snapshot('defect').find((x) => x['所属管线'] === 'PIPE-0001')!
r = runAction('defect', Number(d1.id), '确认缺陷', Number(d1.version ?? 0))
check('乙先确认缺陷落库', r.ok, r.message)
r = runAction('pipeline', Number(pipeSnapshot.id), '停用管线', Number(pipeSnapshot.version ?? 0))
check('甲基于旧快照停用被判冲突', !r.ok && r.code === 'conflict', r.message)
const pipeNow = snapshot('pipeline').find((x) => x['管线编号'] === 'PIPE-0001')!
check('管线回到可操作状态（仍未停用）', pipeNow.status !== '已停用', String(pipeNow.status))
r = runAction('pipeline', Number(pipeNow.id), '停用管线', Number(pipeNow.version ?? 0))
check('甲刷新后重试可继续停用', r.ok, r.message)

// ---------- 场景 6：先停用先胜（反向时序）----------
fresh()
const p3 = snapshot('pipeline').find((x) => x['管线编号'] === 'PIPE-0003')!
const d3snapshot = snapshot('defect').find((x) => x['所属管线'] === 'PIPE-0003')!
r = runAction('pipeline', Number(p3.id), '停用管线', Number(p3.version ?? 0))
check('甲先停用落库', r.ok, r.message)
r = runAction('defect', Number(d3snapshot.id), '确认缺陷', Number(d3snapshot.version ?? 0))
check('乙的缺陷确认被拦截并说明原因', !r.ok && r.code === 'blocked' && r.message.includes('PIPE-0003'), r.message)

// ---------- 场景 7：同一记录两人同时操作 ----------
fresh()
const a1 = snapshot('pipeline').find((x) => Number(x.id) === 1)!
r = runAction('pipeline', 1, '提交建档', Number(a1.version ?? 0))
check('第一人提交建档成功', r.ok, r.message)
r = runAction('pipeline', 1, '发起复核', Number(a1.version ?? 0))
check('第二人基于旧版本操作被判冲突', !r.ok && r.code === 'conflict', r.message)

// ---------- 场景 8：读取失败不等于无记录，重置可恢复 ----------
fresh()
memory.set(storageKey(), '{broken json')
let threw = false
try {
  listEntries('pipeline')
} catch (e) {
  threw = e instanceof Error && e.message.includes('读取失败')
}
check('数据损坏时列表抛错而非返回空', threw)
const recovered = resetModule('pipeline')
check('重置模块后恢复可读', recovered.total === 3)
check('恢复后筛选正常工作', listEntries('pipeline', { 管线编号: 'PIPE-0001' }).total === 1)
check('筛选无匹配返回空（真无记录）', listEntries('pipeline', { 管线编号: '不存在' }).total === 0)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
