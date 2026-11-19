import type { ClaudeSubscriptionUsage, UsageStreamState } from "../shared/contract"

/**
 * Yields the current snapshot at once, or an explicit empty state, and then every
 * change until the signal aborts.
 */
export async function* snapshotStream(
  provider: ClaudeSubscriptionUsage,
  signal?: AbortSignal,
): AsyncIterable<UsageStreamState> {
  const pending: UsageStreamState[] = []
  let wake: (() => void) | undefined
  let last: UsageStreamState | undefined
  const unsubscribe = provider.subscribe((snapshot) => {
    pending.push({ kind: "snapshot", snapshot })
    wake?.()
  })
  const current = provider.current()
  try {
    last = current === null ? { kind: "empty" } : { kind: "snapshot", snapshot: current }
    yield last
    while (signal?.aborted !== true) {
      const next = pending.shift()
      if (next !== undefined) {
        if (
          next.kind === "snapshot" &&
          last?.kind === "snapshot" &&
          next.snapshot === last.snapshot
        ) {
          continue
        }
        last = next
        yield next
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
        const onAbort = (): void => {
          signal?.removeEventListener("abort", onAbort)
          resolve()
        }
        signal?.addEventListener("abort", onAbort, { once: true })
      })
      wake = undefined
    }
  } finally {
    unsubscribe()
  }
}
