import { ref } from 'vue'

/**
 * 故障演练开关：打开后，核心模块（管线/巡检/缺陷）的查询与提交都会模拟一次网络失败。
 * 用来演示「操作失败时保留上次结果并提供重试」，关掉后立即恢复，数据本身不受影响。
 */
export const chaosEnabled = ref(false)

const CHAOS_KEY = 'underground-pipeline-inspection:chaos'

export function loadChaosFlag(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  chaosEnabled.value = window.localStorage.getItem(CHAOS_KEY) === '1'
  chaosEnabled.value &&= true
}

export function toggleChaos(value: boolean): void {
  chaosEnabled.value = value
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CHAOS_KEY, value ? '1' : '0')
  }
}

export class ServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceError'
  }
}

/** 模拟一次网络往返；故障演练开启时直接抛出网络错误。 */
export function networkCall<T>(producer: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      if (chaosEnabled.value) {
        reject(new ServiceError('网络异常，操作未送达（故障演练中）'))
        return
      }
      try {
        resolve(producer())
      } catch (error) {
        reject(error instanceof Error ? error : new ServiceError('服务处理失败'))
      }
    }, 220)
  })
}
