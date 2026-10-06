import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：建立管线/巡检/缺陷关联并引入行版本号，旧缓存结构不再沿用，直接播种新结构。
const STORAGE_KEY = 'underground-pipeline-inspection:entries:v2'

// 跨标签页同步事件名：另一个标签页（另一个值班人）落库后，本页用它刷新缓存。
export const STORE_SYNC_EVENT = 'entries:store-synced'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 播种数据补齐版本号，版本号从 1 开始，之后每次落库 +1。 */
function withRevisions(seed: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const result: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(seed)) {
    result[key] = rows.map((row) => ({ ...row, rev: row.rev ?? 1 }))
  }
  return result
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = withRevisions(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 只补齐种子里存在的模块，页面新增模块字段也不会把缺失误判成空数组。
    const merged: Record<string, EntryRow[]> = { ...fallback }
    for (const [key, rows] of Object.entries(parsed)) {
      merged[key] = Array.isArray(rows) ? rows : fallback[key] ?? []
    }
    return withRevisions(merged)
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/** 一次性写入多个模块（例如缺陷与管线在同一个写事务里 CAS 提交），保证同生共死。 */
export function saveAll(next: Record<string, EntryRow[]>): void {
  const merged = { ...allRows(), ...next }
  cache = merged
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = withRevisions({ [key]: clone(SEED_ROWS[key] ?? []) })[key]
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/**
 * 监听其他标签页（其他值班人）对存储的写入。
 * 浏览器的 storage 事件只在「非写入文档」触发，正好对应多人协作里的其他人；
 * 本标签页自己的提交由调用方在成功后主动 reload，不靠这个事件，避免重复加载。
 */
export function watchExternalChanges(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handle = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return
    cache = null
    onChange()
  }
  window.addEventListener('storage', handle)
  return () => {
    window.removeEventListener('storage', handle)
  }
}

/** 让缓存在下一次读取时重新从 localStorage 加载（冲突处理后主动对齐最新结果）。 */
export function invalidateCache(): void {
  cache = null
}
