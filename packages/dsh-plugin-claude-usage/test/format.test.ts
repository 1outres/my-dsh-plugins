import { describe, expect, it } from "vitest"
import {
  extraUsageValue,
  formatAbsoluteReset,
  formatAge,
  formatTimeShort,
  formatTooltipUpdated,
  limitLabel,
  orderedWindows,
  percentOf,
  primaryWindow,
  toneOfSeverity,
  toneOfStatus,
  windowLabel,
} from "../src/client/format"
import { en, ja } from "../src/client/i18n"
import type { RateLimitSnapshot, UsageExtraUsage, UsageLimit } from "../src/shared/contract"

function translator(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string => {
    let text = dict[key] ?? key
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
const NOW = new Date(2026, 10, 23, 19, 0).getTime()

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

const EXTRA: UsageExtraUsage = {
  isEnabled: true,
  monthlyLimit: 50,
  usedCredits: 12.5,
  utilization: 0.25,
  currency: "USD",
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
    expect(primaryWindow({ ...SNAPSHOT, windows: [SEVEN_DAY] })?.kind).toBe("seven_day")
  })

  it("has no primary window when the snapshot holds none", () => {
    expect(primaryWindow({ ...SNAPSHOT, windows: [] })).toBeNull()
  })

  it("rounds a fraction to a whole percent", () => {
    expect(percentOf(0.42)).toBe(42)
    expect(percentOf(0.184)).toBe(18)
  })

  it("labels the windows with the short names in both languages", () => {
    expect(windowLabel("five_hour", t)).toBe("5h")
    expect(windowLabel("seven_day", t)).toBe("7d")
    expect(windowLabel("five_hour", japanese)).toBe("5h")
    expect(windowLabel("seven_day", japanese)).toBe("7d")
  })
})

describe("tones", () => {
  it("maps the rate limit status to a tone", () => {
    expect(toneOfStatus(undefined)).toBe("normal")
    expect(toneOfStatus("allowed")).toBe("normal")
    expect(toneOfStatus("allowed_warning")).toBe("warning")
    expect(toneOfStatus("rejected")).toBe("error")
  })

  it("maps the report severity to a tone", () => {
    expect(toneOfSeverity("normal")).toBe("normal")
    expect(toneOfSeverity("warning")).toBe("warning")
    expect(toneOfSeverity("critical")).toBe("error")
    expect(toneOfSeverity("urgent")).toBe("normal")
  })
})

describe("short times", () => {
  it("writes days and hours for a time of a day or more", () => {
    const long = 4 * 24 * HOUR + 6 * HOUR
    expect(formatTimeShort(long, t)).toBe("4d 6h")
    expect(formatTimeShort(long, japanese)).toBe("4日6時間")
  })

  it("writes hours and minutes under a day", () => {
    const medium = 2 * HOUR + 13 * MINUTE
    expect(formatTimeShort(medium, t)).toBe("2h 13m")
    expect(formatTimeShort(medium, japanese)).toBe("2時間13分")
  })

  it("writes minutes under an hour", () => {
    expect(formatTimeShort(13 * MINUTE, t)).toBe("13m")
    expect(formatTimeShort(13 * MINUTE, japanese)).toBe("13分")
  })

  it("rounds a partial minute up", () => {
    expect(formatTimeShort(61_000, t)).toBe("2m")
  })
})

describe("reset dates", () => {
  it("writes the local reset date and time", () => {
    const local = new Date(2026, 10, 23, 19, 59).getTime()
    expect(formatAbsoluteReset(local, "en-US")).toBe("11/23 19:59")
  })
})

describe("ages", () => {
  it("writes a compact age in both languages", () => {
    expect(formatAge(3 * MINUTE, t)).toBe("3m")
    expect(formatAge(3 * MINUTE, japanese)).toBe("3分")
    expect(formatAge(2 * HOUR, t)).toBe("2h")
    expect(formatAge(5 * HOUR, japanese)).toBe("5時間")
    expect(formatAge(2 * 24 * HOUR, t)).toBe("2d")
  })

  it("writes the tooltip's updated line, with a separate just-now template", () => {
    expect(formatTooltipUpdated(NOW - 20_000, NOW, t)).toBe("updated just now")
    expect(formatTooltipUpdated(NOW - 20_000, NOW, japanese)).toBe("たった今更新")
    expect(formatTooltipUpdated(NOW - 3 * MINUTE, NOW, t)).toBe("updated 3m ago")
    expect(formatTooltipUpdated(NOW - 3 * MINUTE, NOW, japanese)).toBe("3分前に更新")
  })
})

describe("report labels", () => {
  it("labels the known kinds with short names", () => {
    expect(limitLabel(limit({ kind: "session" }), t)).toBe("5h")
    expect(limitLabel(limit({ kind: "weekly_all" }), t)).toBe("7d")
    expect(limitLabel(limit({ kind: "monthly_custom" }), t)).toBe("monthly_custom")
  })

  it("uses the scope name only for a scoped limit", () => {
    expect(
      limitLabel(
        limit({
          kind: "weekly_scoped",
          scope: { model: { displayName: "Fable" }, surface: null },
        }),
        t,
      ),
    ).toBe("Fable")
    expect(
      limitLabel(
        limit({
          kind: "weekly_scoped",
          scope: { model: null, surface: { displayName: "Web" } },
        }),
        t,
      ),
    ).toBe("Web")
    expect(limitLabel(limit({ kind: "weekly_scoped" }), t)).toBe("weekly_scoped")
  })

  it("writes extra usage compactly", () => {
    expect(extraUsageValue(EXTRA, t)).toBe("12.5/50 USD")
    expect(
      extraUsageValue({ ...EXTRA, usedCredits: null, monthlyLimit: null, currency: null }, t),
    ).toBe("unknown/unknown unknown")
  })
})
