import { afterEach, describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { runNative } from "../../src/native/run"
import type { RateLimitSnapshot } from "../../src/usage/contract"
import { CLEAN_RELAY } from "../support/fake-relay"
import {
  cleanAnswer,
  drainRun,
  type HarnessOptions,
  type NativeHarness,
  nativeErrorAnswer,
  nativeHarness,
  preparedRequest,
} from "../support/native-harness"

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed",
  resetsAt: 1_800_500_000_000,
  windows: [{ kind: "seven_day", utilization: 0.18, resetsAt: 1_800_500_000_000 }],
}

describe("rate limit handoff", () => {
  const harnesses: NativeHarness[] = []

  function harness(options: HarnessOptions): NativeHarness {
    const created = nativeHarness(options)
    harnesses.push(created)
    return created
  }

  function clean(rateLimit: RateLimitSnapshot | null): NativeHarness {
    return harness({
      relay: { ...CLEAN_RELAY, rateLimit },
      scenario: { script: [...cleanAnswer(), { exit: 0 }] },
    })
  }

  async function failureOf(promise: Promise<unknown>): Promise<NativeFailure> {
    const outcome = await promise.then(
      () => undefined,
      (error: unknown) => error,
    )
    if (outcome instanceof NativeFailure) return outcome
    throw new Error(`expected a NativeFailure, got ${String(outcome)}`)
  }

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((created) => created.dispose()))
  })

  it("hands the snapshot of a clean answer to the usage service", async () => {
    const created = clean(SNAPSHOT)
    const { completion } = await drainRun(runNative(preparedRequest(), undefined, created.deps))
    expect(completion.requestId).toBe("req_fixture")
    expect(created.rateLimits).toEqual([SNAPSHOT])
  })

  it("hands the snapshot of a 429 answer even though the call fails", async () => {
    const created = harness({
      relay: {
        used: true,
        status: 429,
        denied: 1,
        rateLimit: SNAPSHOT,
        errorText: "slow down",
      },
      scenario: {
        script: [...nativeErrorAnswer("rate_limit", "You've hit your session limit")],
      },
    })
    const failure = await failureOf(runNative(preparedRequest(), undefined, created.deps).next())
    expect(failure.code).toBe(FailureCode.rateLimit)
    expect(created.rateLimits).toEqual([SNAPSHOT])
  })

  it("reports nothing when the answer had no unified headers", async () => {
    const created = clean(null)
    await drainRun(runNative(preparedRequest(), undefined, created.deps))
    expect(created.rateLimits).toEqual([])
  })

  it("reports one snapshot per call", async () => {
    const created = clean(SNAPSHOT)
    await drainRun(runNative(preparedRequest(), undefined, created.deps))
    await drainRun(runNative(preparedRequest(), undefined, created.deps))
    expect(created.rateLimits).toHaveLength(2)
  })
})
