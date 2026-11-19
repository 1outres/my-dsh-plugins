import { describe, expect, it } from "vitest"
import {
  extraUsageText,
  formatAbsoluteReset,
  formatAge,
  formatLimitReached,
  formatTimeLeft,
  groupLabel,
  groupLimits,
  limitLabel,
  orderedWindows,
  percentOf,
  primaryWindow,
  statusLabel,
  toneOfSeverity,
  toneOfStatus,
  windowLabel,
} from "../src/client/format"
import { en, ja } from "../src/client/i18n"
import type { RateLimitSnapshot, UsageLimit, UsageReport } from "../src/shared/contract"

function translator(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dict[key] ?? key
    let text = template
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }
}

const t = translator(en)
const japanese = translator(ja)

const HOUR = 3_600_000
const MINUTE = 60_000

const FIVE_HOUR = {
  kind: "five_hour" as const,
  utilization: 0.42,
  resetsAt: 1_800_000_000_000,
}
const SEVEN_DAY = {
  kind: "seven_day" as const,
  utilization: 0.18,
  resetsAt: 1_800_000_000_000,
}

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed",
  windows: [SEVEN_DAY, FIVE_HOUR],
}

function limit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    kind: "weekly_all",
    group: "weekly",
    percent: 19,
    resetsAt: null,
    scope: null,
    severity: "normal",
    isActive: true,
    ...overrides,
  }
}

describe("window selection", () => {
  it("puts the five-hour window first when it exists", () => {
    expect(orderedWindows(SNAPSHOT).map((window) => window.kind)).toEqual([
      "five_hour",
      "seven_day",
    ])
    expect(primaryWindow(SNAPSHOT)?.kind).toBe("five_hour")
  })

  it("uses the seven-day window when the account has no five-hour window", () => {
    const snapshot = { ...SNAPSHOT, windows: [SEVEN_DAY] }
    expect(primaryWindow(snapshot)?.kind).toBe("seven_day")
  })

  it("has no primary window when the snapshot holds none", () => {
    expect(primaryWindow({ ...SNAPSHOT, windows: [] })).toBeNull()
  })

  it("rounds a fraction to a whole percent", () => {
    expect(percentOf(0.42)).toBe(42)
    expect(percentOf(0.184)).toBe(18)
  })

  it("labels the windows in both languages", () => {
    expect(windowLabel("five_hour", t)).toBe("5-hour")
    expect(windowLabel("seven_day", t)).toBe("Week")
    expect(windowLabel("five_hour", japanese)).toBe("5時間")
    expect(windowLabel("seven_day", japanese)).toBe("週")
  })
})

describe("status and severity tones", () => {
  it("maps the rate limit status to a tone", () => {
    expect(toneOfStatus(undefined)).toBe("normal")
    expect(toneOfStatus("allowed")).toBe("normal")
    expect(toneOfStatus("allowed_warning")).toBe("warning")
    expect(toneOfStatus("rejected")).toBe("error")
  })

  it("keeps an unknown severity neutral", () => {
    expect(toneOfSeverity("normal")).toBe("normal")
    expect(toneOfSeverity("warning")).toBe("warning")
    expect(toneOfSeverity("critical")).toBe("error")
    expect(toneOfSeverity("urgent")).toBe("normal")
  })

  it("labels the statuses", () => {
    expect(statusLabel("allowed_warning", t)).toBe("Warning")
    expect(statusLabel("rejected", japanese)).toBe("上限到達")
  })
})

describe("times", () => {
  it("shows a relative time left in hours and padded minutes", () => {
    expect(formatTimeLeft(2 * HOUR + 13 * MINUTE, t)).toBe("in 2h 13m")
    expect(formatTimeLeft(2 * HOUR + 13 * MINUTE, japanese)).toBe("あと2時間13分")
    expect(formatTimeLeft(5 * MINUTE, t)).toBe("in 5m")
  })

  it("rounds a partial minute up", () => {
    expect(formatTimeLeft(61_000, t)).toBe("in 2m")
  })

  it("writes the limit-reached text of a rejected primary window", () => {
    expect(formatLimitReached(HOUR + 5 * MINUTE, t)).toBe("Limit reached · resets in 1h 05m")
    expect(formatLimitReached(HOUR + 5 * MINUTE, japanese)).toBe("上限到達 · あと1時間05分で解除")
    expect(formatLimitReached(5 * MINUTE, t)).toBe("Limit reached · resets in 5m")
  })

  it("writes the local reset date and time", () => {
    const local = new Date(2026, 10, 23, 19, 59).getTime()
    expect(formatAbsoluteReset(local, "en-US")).toBe("11/23 19:59")
  })

  it("writes how long ago the snapshot arrived", () => {
    expect(formatAge(3 * MINUTE, t)).toBe("3 min")
    expect(formatAge(3 * MINUTE, japanese)).toBe("3分")
    expect(formatAge(2 * HOUR, t)).toBe("2 h")
    expect(formatAge(5 * HOUR, japanese)).toBe("5時間")
    expect(formatAge(2 * 24 * HOUR, t)).toBe("2 d")
    expect(formatAge(20_000, t)).toBe("just now")
    expect(formatAge(-5_000, t)).toBe("just now")
  })
})

describe("report limits", () => {
  it("labels known kinds and keeps unknown kinds as they are", () => {
    expect(limitLabel(limit({ kind: "session" }), t)).toBe("5-hour")
    expect(limitLabel(limit({ kind: "weekly_all" }), t)).toBe("Weekly (all models)")
    expect(
      limitLabel(
        limit({
          kind: "weekly_scoped",
          scope: { model: { displayName: "Fable" }, surface: null },
        }),
        t,
      ),
    ).toBe("Weekly (Fable)")
    expect(
      limitLabel(
        limit({
          kind: "weekly_scoped",
          scope: { model: null, surface: { displayName: "Web" } },
        }),
        japanese,
      ),
    ).toBe("週間（Web）")
    expect(limitLabel(limit({ kind: "weekly_scoped" }), t)).toBe("weekly_scoped")
    expect(limitLabel(limit({ kind: "monthly_scoped" }), t)).toBe("monthly_scoped")
  })

  it("labels known groups and keeps unknown groups as they are", () => {
    expect(groupLabel("session", t)).toBe("5-hour")
    expect(groupLabel("weekly", japanese)).toBe("週間")
    expect(groupLabel("monthly", t)).toBe("monthly")
  })

  it("groups limits in server order", () => {
    const groups = groupLimits([
      limit({ kind: "weekly_all", group: "weekly" }),
      limit({ kind: "session", group: "session" }),
      limit({ kind: "weekly_scoped", group: "weekly" }),
    ])
    expect(groups.map((group) => group.group)).toEqual(["weekly", "session"])
    expect(groups[0]?.limits.map((entry) => entry.kind)).toEqual(["weekly_all", "weekly_scoped"])
  })

  it("writes extra usage, with an explicit unknown for a missing value", () => {
    const report: UsageReport = {
      fetchedAt: 0,
      limits: [],
      extraUsage: {
        isEnabled: true,
        monthlyLimit: 50,
        usedCredits: 12.5,
        utilization: 0.25,
        currency: "USD",
      },
    }
    expect(extraUsageText(report, t)).toBe("Extra usage 12.5 / 50 USD")
    const missing: UsageReport = {
      ...report,
      extraUsage: { ...report.extraUsage, monthlyLimit: null, usedCredits: null, currency: null },
    }
    expect(extraUsageText(missing, t)).toBe("Extra usage unknown / unknown unknown")
  })
})
