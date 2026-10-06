import { ref } from 'vue'

/**
 * 新建表单草稿：写入 localStorage，关掉弹窗、刷新页面、操作中断后再打开都能继续填写。
 * 提交成功或主动放弃时才清空，绝不会因为一次网络失败把已填内容丢掉。
 */
const DRAFT_PREFIX = 'underground-pipeline-inspection:draft:'

export function useDraft(key: string, empty: Record<string, string>) {
  const storageKey = `${DRAFT_PREFIX}${key}`
  const hasDraft = ref(false)

  function read(): Record<string, string> | null {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Record<string, string>
      hasDraft.value = true
      return { ...empty, ...parsed }
    } catch {
      return null
    }
  }

  function save(values: Record<string, string>): void {
    hasDraft.value = true
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(storageKey, JSON.stringify(values))
    }
  }

  function clear(): void {
    hasDraft.value = false
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(storageKey)
    }
  }

  return { hasDraft, readDraft: read, saveDraft: save, clearDraft: clear }
}
