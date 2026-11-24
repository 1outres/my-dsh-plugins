import type { SnapshotStore } from "./store"

export function createClock(stepMs: number, now: () => number): SnapshotStore<number> {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => Math.floor(now() / stepMs) * stepMs,
    subscribe(listener) {
      listeners.add(listener)
      if (timer === undefined) timer = setInterval(notify, stepMs)
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0 || timer === undefined) return
        clearInterval(timer)
        timer = undefined
      }
    },
  }
}
