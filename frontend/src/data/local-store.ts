import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'

/** 存储层读取失败时抛出，调用方必须显式处理，不能悄悄当成「没有记录」。 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
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
    return { ...fallback, ...parsed }
  } catch {
    // 数据损坏时不能回退到示例数据：那会把「读取失败」伪装成「没有记录」。
    throw new StorageError('本地数据读取失败：存储内容已损坏，可重试，或重置对应模块数据')
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/**
 * 读写前对齐 localStorage：别的标签页刚落库的改动这里立刻可见。
 * 这是多人同时操作时「先落库者胜」的判定依据；读取失败会抛 StorageError。
 */
export function syncFromStorage(): void {
  cache = readStorage()
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

function persist(next: Record<string, EntryRow[]>): void {
  // 先写 localStorage 再换缓存：写失败时缓存保持旧值，两边不会各说各话。
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

export function saveRows(key: string, rows: EntryRow[]): void {
  persist({ ...allRows(), [key]: rows })
}

/** 一次落库多个模块：跨模块联动（如缺陷确认联动管线版本）必须原子写入。 */
export function saveAll(next: Record<string, EntryRow[]>): void {
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  // 重置是数据损坏时的恢复手段：先尝试对齐落库内容，读不出来就基于示例数据重建。
  let base: Record<string, EntryRow[]>
  try {
    syncFromStorage()
    base = allRows()
  } catch {
    base = cache ?? clone(SEED_ROWS)
  }
  persist({ ...base, [key]: rows })
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
