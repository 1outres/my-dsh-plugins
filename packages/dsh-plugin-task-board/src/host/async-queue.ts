export interface AsyncQueue<T> {
  push(value: T): void
  take(signal?: AbortSignal): Promise<T | undefined>
  close(): void
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const items: T[] = []
  let wake: (() => void) | undefined
  let closed = false

  const settle = (): void => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }

  return {
    push(value) {
      if (closed) return
      items.push(value)
      settle()
    },
    async take(signal) {
      for (;;) {
        const value = items.shift()
        if (value !== undefined) return value
        if (closed) return undefined
        if (signal?.aborted === true) return undefined
        await new Promise<void>((resolve) => {
          const onAbort = (): void => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
          }
          signal?.addEventListener("abort", onAbort, { once: true })
          wake = () => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
          }
        })
      }
    },
    close() {
      closed = true
      items.length = 0
      settle()
    },
  }
}
