import { setTimeout as sleep } from "node:timers/promises"
import type { SubprocessHandle } from "@deepseek-ai/dsh-subprocess"
import type { Relay } from "../contract"

export const DRAIN_GRACE_MS = 10_000
const TERMINATE_WAIT_MS = 5_000

/** Waits for the promise to settle, up to the limit. Rejection counts as settled. */
export async function settledWithin(work: Promise<unknown>, limitMs: number): Promise<void> {
  const limit = new AbortController()
  const settled = work.then(
    () => undefined,
    () => undefined,
  )
  const timer = sleep(limitMs, undefined, { signal: limit.signal, ref: false }).catch(
    () => undefined,
  )
  await Promise.race([settled, timer])
  limit.abort()
}

/**
 * Finishes a call that already returned its answer. The CLI gets a grace period to exit, and is
 * then ended. The relay stays open until that point, so late CLI requests still meet the consumed
 * admission and never reach the network.
 */
export async function drainAfterAnswer(
  handle: Pick<SubprocessHandle, "done" | "terminate">,
  relay: Pick<Relay, "close">,
  graceMs: number = DRAIN_GRACE_MS,
): Promise<void> {
  await settledWithin(handle.done, graceMs)
  handle.terminate()
  await settledWithin(handle.done, TERMINATE_WAIT_MS)
  await relay.close()
}
