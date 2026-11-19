import { describe, expect, it, vi } from "vitest"
import { USAGE_SERVICE } from "../src/host/dependency"
import { reportResult } from "../src/host/report"
import { snapshotStream } from "../src/host/snapshots"
import type {
  ClaudeSubscriptionUsage,
  RateLimitSnapshot,
  UsageReport,
} from "../src/shared/contract"

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed",
  windows: [{ kind: "seven_day", utilization: 0.18, resetsAt: 1_800_500_000_000 }],
}

const NEXT: RateLimitSnapshot = {
  observedAt: 1_800_000_030_000,
  status: "allowed_warning",
  windows: [{ kind: "seven_day", utilization: 0.9, resetsAt: 1_800_500_000_000 }],
}

const REPORT: UsageReport = {
  fetchedAt: 1_800_000_000_000,
  limits: [],
  extraUsage: {
    isEnabled: false,
    monthlyLimit: null,
    usedCredits: null,
    utilization: null,
    currency: null,
  },
}

function fakeProvider(): ClaudeSubscriptionUsage & {
  push(snapshot: RateLimitSnapshot): void
  setCurrent(snapshot: RateLimitSnapshot | null): void
  report: ReturnType<typeof vi.fn>
} {
  let current: RateLimitSnapshot | null = null
  const listeners = new Set<(snapshot: RateLimitSnapshot) => void>()
  const report = vi.fn(async () => REPORT)
  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fetchReport: report,
    setCurrent(snapshot) {
      current = snapshot
    },
    push(snapshot) {
      current = snapshot
      for (const listener of [...listeners]) listener(snapshot)
    },
    report,
  }
}

describe("the claude-usage Host half", () => {
  it("requires the claudeSubscriptionUsage service", () => {
    expect(USAGE_SERVICE).toBe("claudeSubscriptionUsage")
  })

  it("yields an explicit empty state first when nothing is known", async () => {
    const provider = fakeProvider()
    const iterator = snapshotStream(provider)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { kind: "empty" } })
    const update = iterator.next()
    provider.push(SNAPSHOT)
    await expect(update).resolves.toEqual({
      done: false,
      value: { kind: "snapshot", snapshot: SNAPSHOT },
    })
    await iterator.return?.()
  })

  it("yields the current snapshot first, then each change", async () => {
    const provider = fakeProvider()
    provider.setCurrent(SNAPSHOT)
    const iterator = snapshotStream(provider)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: "snapshot", snapshot: SNAPSHOT },
    })
    const update = iterator.next()
    provider.push(NEXT)
    await expect(update).resolves.toEqual({
      done: false,
      value: { kind: "snapshot", snapshot: NEXT },
    })
    await iterator.return?.()
  })

  it("skips a queued copy of the snapshot it already yielded", async () => {
    const provider = fakeProvider()
    provider.setCurrent(SNAPSHOT)
    const iterator = snapshotStream(provider)[Symbol.asyncIterator]()
    await iterator.next()
    const update = iterator.next()
    provider.push(SNAPSHOT)
    provider.push(NEXT)
    await expect(update).resolves.toEqual({
      done: false,
      value: { kind: "snapshot", snapshot: NEXT },
    })
    await iterator.return?.()
  })

  it("stops following changes when the stream is closed", async () => {
    const provider = fakeProvider()
    const iterator = snapshotStream(provider)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    provider.push(SNAPSHOT)
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
  })

  it("ends the stream when its signal aborts", async () => {
    const controller = new AbortController()
    const iterator = snapshotStream(fakeProvider(), controller.signal)[Symbol.asyncIterator]()
    await iterator.next()
    const pending = iterator.next()
    controller.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it("returns the report, and a failure as a message", async () => {
    const provider = fakeProvider()
    await expect(reportResult(provider)).resolves.toEqual({ ok: true, report: REPORT })
    provider.report.mockRejectedValueOnce(new Error("usage probe failed"))
    await expect(reportResult(provider)).resolves.toEqual({
      ok: false,
      message: "usage probe failed",
    })
  })

  it("passes the abort signal to the provider", async () => {
    const provider = fakeProvider()
    const controller = new AbortController()
    await reportResult(provider, controller.signal)
    expect(provider.report).toHaveBeenCalledWith(controller.signal)
  })
})
