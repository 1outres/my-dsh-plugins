import { describe, expect, it, vi } from "vitest"
import { createUsageBridge } from "../src/client/bridge"
import type {
  ClientContext,
  RemoteUsageResult,
  UsageRemote,
  UsageStreamHandle,
} from "../src/client/types"
import type { RateLimitSnapshot, UsageStreamState } from "../src/shared/contract"

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed",
  windows: [{ kind: "seven_day", utilization: 0.18, resetsAt: 1_800_500_000_000 }],
}

interface ControlledStream {
  handle: UsageStreamHandle
  push(item: UsageStreamState): void
  end(): void
  fail(error: unknown): void
  readonly disposed: boolean
}

function controlledStream(): ControlledStream {
  const queue: UsageStreamState[] = []
  let error: unknown
  let ended = false
  let disposed = false
  let wake: (() => void) | undefined
  const kick = (): void => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }
  const iterator: AsyncIterator<UsageStreamState> = {
    async next() {
      while (queue.length === 0 && error === undefined && !ended && !disposed) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      if (error !== undefined) {
        const thrown = error
        error = undefined
        throw thrown
      }
      const item = queue.shift()
      if (item !== undefined) return { done: false, value: item }
      return { done: true, value: undefined }
    },
  }
  const handle: UsageStreamHandle = {
    [Symbol.asyncIterator]() {
      return iterator
    },
    dispose() {
      disposed = true
      kick()
    },
  }
  return {
    handle,
    push(item) {
      queue.push(item)
      kick()
    },
    end() {
      ended = true
      kick()
    },
    fail(thrown) {
      error = thrown
      kick()
    },
    get disposed() {
      return disposed
    },
  }
}

interface Harness {
  ctx: ClientContext
  streams: ControlledStream[]
  mount: ReturnType<typeof vi.fn>
  report: ReturnType<typeof vi.fn>
}

function harness(
  overrides: {
    mount?: () => Promise<() => Promise<void>>
    report?: () => Promise<RemoteUsageResult>
    /** Items each stream delivers before it ends, by attempt number. */
    streamItems?: (index: number) => readonly UsageStreamState[]
  } = {},
): Harness {
  const streams: ControlledStream[] = []
  const mount = vi.fn(overrides.mount ?? (async () => async () => {}))
  const defaultReport = async (): Promise<RemoteUsageResult> => ({
    ok: true,
    value: {
      ok: true,
      report: {
        fetchedAt: 0,
        limits: [],
        extraUsage: {
          isEnabled: false,
          monthlyLimit: null,
          usedCredits: null,
          utilization: null,
          currency: null,
        },
      },
    },
  })
  const report = vi.fn(overrides.report ?? defaultReport)
  const remote: UsageRemote = {
    snapshots() {
      const stream = controlledStream()
      streams.push(stream)
      if (overrides.streamItems !== undefined) {
        for (const item of overrides.streamItems(streams.length - 1)) stream.push(item)
        stream.end()
      }
      return stream.handle
    },
    report,
  }
  const ctx = {
    effect: () => {},
    get: (name: string) => (name === "remote.claudeUsage" ? remote : undefined),
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    remote: { $mount: mount },
  }
  return { ctx, streams, mount, report }
}

describe("createUsageBridge", () => {
  it("mounts the contribution and follows the stream", async () => {
    const test = harness()
    const bridge = createUsageBridge(test.ctx)
    await vi.waitFor(() => expect(test.streams).toHaveLength(1))
    expect(test.mount).toHaveBeenCalledTimes(1)
    test.streams[0]?.push({ kind: "empty" })
    await vi.waitFor(() =>
      expect(bridge.store.getSnapshot()).toEqual({ connected: true, snapshot: null }),
    )
    test.streams[0]?.push({ kind: "snapshot", snapshot: SNAPSHOT })
    await vi.waitFor(() =>
      expect(bridge.store.getSnapshot()).toEqual({ connected: true, snapshot: SNAPSHOT }),
    )
    bridge.dispose()
    expect(test.streams[0]?.disposed).toBe(true)
  })

  it("stays hidden when the contribution cannot be mounted", async () => {
    const test = harness({ mount: async () => Promise.reject(new Error("no host")) })
    const bridge = createUsageBridge(test.ctx)
    await vi.waitFor(() => expect(test.mount).toHaveBeenCalledTimes(1))
    expect(test.streams).toHaveLength(0)
    expect(bridge.store.getSnapshot()).toEqual({ connected: false, snapshot: null })
    bridge.dispose()
  })

  it("reconnects after the stream ends", async () => {
    const test = harness()
    const bridge = createUsageBridge(test.ctx, { baseDelayMs: 5 })
    await vi.waitFor(() => expect(test.streams).toHaveLength(1))
    test.streams[0]?.push({ kind: "empty" })
    await vi.waitFor(() => expect(bridge.store.getSnapshot().connected).toBe(true))
    test.streams[0]?.end()
    await vi.waitFor(() => expect(test.streams).toHaveLength(2))
    bridge.dispose()
  })

  it("unwraps the Host report result", async () => {
    const test = harness()
    const bridge = createUsageBridge(test.ctx)
    const ready = {
      ok: true as const,
      report: {
        fetchedAt: 0,
        limits: [],
        extraUsage: {
          isEnabled: false,
          monthlyLimit: null,
          usedCredits: null,
          utilization: null,
          currency: null,
        },
      },
    }
    test.report.mockResolvedValueOnce({ ok: true, value: ready })
    await expect(bridge.loadReport()).resolves.toEqual(ready)
    test.report.mockResolvedValueOnce({ ok: false, error: { message: "refused" } })
    await expect(bridge.loadReport()).resolves.toEqual({ ok: false, message: "refused" })
    test.report.mockRejectedValueOnce(new Error("offline"))
    await expect(bridge.loadReport()).resolves.toEqual({ ok: false, message: "offline" })
    bridge.dispose()
  })

  it("backs off from the base delay to the cap", async () => {
    vi.useFakeTimers()
    try {
      const test = harness({ streamItems: () => [] })
      const bridge = createUsageBridge(test.ctx, { baseDelayMs: 100, maxDelayMs: 400 })
      await vi.advanceTimersByTimeAsync(0)
      expect(test.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(99)
      expect(test.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(test.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(199)
      expect(test.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(test.streams).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(399)
      expect(test.streams).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(test.streams).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(400)
      expect(test.streams).toHaveLength(5)
      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("resets the backoff after the stream delivers an item", async () => {
    vi.useFakeTimers()
    try {
      const test = harness({
        streamItems: (index) => (index === 2 ? [{ kind: "empty" }] : []),
      })
      const bridge = createUsageBridge(test.ctx, { baseDelayMs: 100, maxDelayMs: 400 })
      await vi.advanceTimersByTimeAsync(0)
      expect(test.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(100)
      expect(test.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(200)
      expect(test.streams).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(100)
      expect(test.streams).toHaveLength(4)
      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops reconnecting and clears the bar when disposed", async () => {
    const test = harness()
    const bridge = createUsageBridge(test.ctx, { baseDelayMs: 5 })
    await vi.waitFor(() => expect(test.streams).toHaveLength(1))
    test.streams[0]?.push({ kind: "snapshot", snapshot: SNAPSHOT })
    await vi.waitFor(() => expect(bridge.store.getSnapshot().snapshot).toBe(SNAPSHOT))
    bridge.dispose()
    expect(bridge.store.getSnapshot()).toEqual({ connected: false, snapshot: null })
    expect(test.streams[0]?.disposed).toBe(true)
  })
})
