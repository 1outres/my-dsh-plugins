import { describe, expect, it } from "vitest"
import { parseRateLimitSnapshot } from "../../src/usage/headers"

const OBSERVED_AT = 1_800_000_000_000

const LIVE = {
  "anthropic-ratelimit-unified-overage-status": "rejected",
  "anthropic-ratelimit-unified-representative-claim": "seven_day",
  "anthropic-ratelimit-unified-reset": "1795431600",
  "anthropic-ratelimit-unified-7d-reset": "1795431600",
  "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-fallback-percentage": "0.5",
  "anthropic-ratelimit-unified-overage-disabled-reason": "org_level_disabled",
  "anthropic-ratelimit-unified-7d-utilization": "0.18",
  "anthropic-ratelimit-unified-status": "allowed",
}

describe("parseRateLimitSnapshot", () => {
  it("reads the headers a Pro account sends", () => {
    expect(parseRateLimitSnapshot(LIVE, OBSERVED_AT)).toEqual({
      observedAt: OBSERVED_AT,
      status: "allowed",
      resetsAt: 1_795_431_600_000,
      representativeClaim: "seven_day",
      windows: [
        {
          kind: "seven_day",
          utilization: 0.18,
          resetsAt: 1_795_431_600_000,
          status: "allowed",
        },
      ],
      overage: { status: "rejected", disabledReason: "org_level_disabled" },
      fallbackPercentage: 0.5,
    })
  })

  it("reads both windows in a fixed order", () => {
    const snapshot = parseRateLimitSnapshot(
      {
        "anthropic-ratelimit-unified-status": "allowed_warning",
        "anthropic-ratelimit-unified-5h-reset": "1800000000",
        "anthropic-ratelimit-unified-5h-status": "allowed_warning",
        "anthropic-ratelimit-unified-5h-utilization": "0.42",
        "anthropic-ratelimit-unified-7d-reset": "1800100000",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": "0.9",
        "anthropic-ratelimit-unified-overage-reset": "1800200000",
        "anthropic-ratelimit-unified-overage-status": "allowed",
      },
      OBSERVED_AT,
    )
    expect(snapshot?.windows).toEqual([
      {
        kind: "five_hour",
        utilization: 0.42,
        resetsAt: 1_800_000_000_000,
        status: "allowed_warning",
      },
      {
        kind: "seven_day",
        utilization: 0.9,
        resetsAt: 1_800_100_000_000,
        status: "allowed",
      },
    ])
    expect(snapshot?.overage).toEqual({ status: "allowed", resetsAt: 1_800_200_000_000 })
    expect(snapshot?.status).toBe("allowed_warning")
    expect(snapshot?.resetsAt).toBeUndefined()
    expect(snapshot?.representativeClaim).toBeUndefined()
    expect(snapshot?.fallbackPercentage).toBeUndefined()
  })

  it("is null without unified headers", () => {
    expect(parseRateLimitSnapshot({}, OBSERVED_AT)).toBeNull()
    expect(parseRateLimitSnapshot({ "content-type": "application/json" }, OBSERVED_AT)).toBeNull()
  })

  it("is null without a valid unified status", () => {
    expect(
      parseRateLimitSnapshot({ "anthropic-ratelimit-unified-status": "maybe" }, OBSERVED_AT),
    ).toBeNull()
    expect(
      parseRateLimitSnapshot({ "anthropic-ratelimit-unified-7d-utilization": "0.2" }, OBSERVED_AT),
    ).toBeNull()
  })

  it.each([
    ["a missing utilization", { "anthropic-ratelimit-unified-5h-reset": "1800000000" }],
    ["a missing reset", { "anthropic-ratelimit-unified-5h-utilization": "0.4" }],
    [
      "an unreadable utilization",
      {
        "anthropic-ratelimit-unified-5h-utilization": "NaN",
        "anthropic-ratelimit-unified-5h-reset": "1800000000",
      },
    ],
    [
      "an empty utilization",
      {
        "anthropic-ratelimit-unified-5h-utilization": "",
        "anthropic-ratelimit-unified-5h-reset": "1800000000",
      },
    ],
    [
      "an unreadable reset",
      {
        "anthropic-ratelimit-unified-5h-utilization": "0.4",
        "anthropic-ratelimit-unified-5h-reset": "soon",
      },
    ],
    [
      "an infinite reset",
      {
        "anthropic-ratelimit-unified-5h-utilization": "0.4",
        "anthropic-ratelimit-unified-5h-reset": "Infinity",
      },
    ],
  ])("drops a window with %s", (_case, headers) => {
    const snapshot = parseRateLimitSnapshot(
      { "anthropic-ratelimit-unified-status": "allowed", ...headers },
      OBSERVED_AT,
    )
    expect(snapshot?.windows).toEqual([])
  })

  it("keeps a window whose status is unknown, without a status", () => {
    const snapshot = parseRateLimitSnapshot(
      {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": "0.3",
        "anthropic-ratelimit-unified-7d-reset": "1800000000",
        "anthropic-ratelimit-unified-7d-status": "later",
      },
      OBSERVED_AT,
    )
    expect(snapshot?.windows).toEqual([
      { kind: "seven_day", utilization: 0.3, resetsAt: 1_800_000_000_000 },
    ])
  })

  it("drops an overage block with no valid status", () => {
    const snapshot = parseRateLimitSnapshot(
      {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-overage-status": "later",
        "anthropic-ratelimit-unified-overage-reset": "1800000000",
      },
      OBSERVED_AT,
    )
    expect(snapshot?.overage).toBeUndefined()
  })

  it("accepts zero values and ignores case and array wrappers", () => {
    const snapshot = parseRateLimitSnapshot(
      {
        "Anthropic-RateLimit-Unified-Status": ["rejected"],
        "ANTHROPIC-RATELIMIT-UNIFIED-5H-UTILIZATION": "0",
        "anthropic-ratelimit-unified-5h-reset": "0",
      },
      OBSERVED_AT,
    )
    expect(snapshot).toEqual({
      observedAt: OBSERVED_AT,
      status: "rejected",
      windows: [{ kind: "five_hour", utilization: 0, resetsAt: 0 }],
    })
  })
})
