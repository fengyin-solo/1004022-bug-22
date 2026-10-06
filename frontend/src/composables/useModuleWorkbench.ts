import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import { commitAction, fetchAll, fetchPage } from '@/api/core-service'
import { ServiceError } from '@/api/chaos'
import { watchExternalChanges } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

export type RowFeedback = {
  type: 'error' | 'conflict' | 'success'
  text: string
}

type Options = {
  key: string
  /** 依据全量数据统计卡片，避免筛选后卡片/图例被误读为 0。 */
  buildStats: (rows: EntryRow[]) => { label: string; value: number | string }[]
}

export function useModuleWorkbench(options: Options) {
  const filters = ref<Record<string, string>>({})
  const rows = ref<EntryRow[]>([])
  const allRowsRef = ref<EntryRow[]>([])
  const total = computed(() => rows.value.length)

  // loadState：success 之前 rows 一律不动，所以失败时页面保留的是上一次成功结果。
  const loadState = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
  const loadError = ref('')
  const hasLoaded = ref(false)

  const busyMap = reactive<Record<string, boolean>>({})
  const feedbackMap = reactive<Record<string, RowFeedback>>({})

  const hasActiveFilters = computed(() =>
    Object.values(filters.value).some((value) => String(value ?? '').trim() !== ''),
  )
  const stats = computed(() => options.buildStats(allRowsRef.value))

  function feedbackKey(id: number | string, action: string): string {
    return `${id}__${action}`
  }

  function isBusy(id: number | string, action: string): boolean {
    return Boolean(busyMap[feedbackKey(id, action)])
  }

  function feedback(id: number | string, action: string): RowFeedback | undefined {
    return feedbackMap[feedbackKey(id, action)]
  }

  async function reload(showLoading = true): Promise<void> {
    if (showLoading) loadState.value = 'loading'
    loadError.value = ''
    try {
      const [page, full] = await Promise.all([
        fetchPage(options.key, filters.value),
        fetchAll(options.key),
      ])
      rows.value = page.items
      allRowsRef.value = full.items
      loadState.value = 'success'
      hasLoaded.value = true
    } catch (error) {
      // 关键约定：失败时不覆盖 rows/allRowsRef，页面继续展示上次结果，只提示可重试。
      loadError.value = error instanceof ServiceError ? error.message : '列表读取失败，已保留上次结果'
      loadState.value = 'error'
    }
  }

  function resetFilters() {
    filters.value = {}
    void reload()
  }

  async function runAction(action: string, row: EntryRow): Promise<void> {
    const key = feedbackKey(row.id, action)
    busyMap[key] = true
    delete feedbackMap[key]
    let result: ActionResult
    try {
      result = await commitAction(options.key, Number(row.id), action, Number(row.rev ?? 1))
    } catch (error) {
      // 网络失败：行数据完全不动，给出原样重试入口。
      feedbackMap[key] = {
        type: 'error',
        text: error instanceof ServiceError ? error.message : '提交失败，数据未改动',
      }
      busyMap[key] = false
      return
    }
    busyMap[key] = false

    if (result.ok) {
      feedbackMap[key] = { type: 'success', text: result.message }
      await reload(false)
      return
    }

    if (result.code === 'CONFLICT' && result.current) {
      // 先落库的人赢了：本页这行先回到与库一致的最新状态，操作人确认后可以继续处理。
      const current = result.current
      rows.value = rows.value.map((item) => (Number(item.id) === Number(current.id) ? current : item))
      allRowsRef.value = allRowsRef.value.map((item) =>
        Number(item.id) === Number(current.id) ? current : item,
      )
      feedbackMap[key] = { type: 'conflict', text: result.message }
      return
    }

    // BLOCKED / NOT_FOUND：业务拦截，数据不变，只说明原因。
    feedbackMap[key] = { type: 'error', text: result.message }
  }

  /** 冲突提示后，操作人按最新状态再次提交（中断后继续处理的入口）。 */
  async function continueWithLatest(action: string, row: EntryRow): Promise<void> {
    await runAction(action, row)
  }

  let stopWatch: (() => void) | null = null
  onMounted(() => {
    void reload()
    // 另一个标签页（另一个值班人）落库后，本页静默对齐；失败仍保留本页结果。
    stopWatch = watchExternalChanges(() => {
      void reload(false)
    })
  })
  onUnmounted(() => stopWatch?.())

  return {
    filters,
    rows,
    allRows: allRowsRef,
    total,
    stats,
    loadState,
    loadError,
    hasLoaded,
    hasActiveFilters,
    isBusy,
    feedback,
    reload,
    resetFilters,
    runAction,
    continueWithLatest,
  }
}
