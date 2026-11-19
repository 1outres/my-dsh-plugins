import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { en } from "../src/client/i18n"
import { createUsageStore } from "../src/client/store"
import type { ReportView, UsageState } from "../src/client/types"
import { UsageBar } from "../src/client/UsageBar"
import { UsagePopover } from "../src/client/UsagePopover"
import type { RateLimitSnapshot, UsageReport, UsageReportResult } from "../src/shared/contract"

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
const HOUR = 3_600_000
const MINUTE = 60_000
const NOW = new Date(2026, 10, 23, 19, 0).getTime()

const FIVE_HOUR = {
  kind: "five_hour" as const,
  utilization: 0.42,
  resetsAt: NOW + 2 * HOUR + 13 * MINUTE,
  status: "allowed" as const,
}
const SEVEN_DAY = {
  kind: "seven_day" as const,
  utilization: 0.18,
  resetsAt: new Date(2026, 10, 23, 19, 59).getTime(),
  status: "allowed" as const,
}

function snapshot(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return {
    observedAt: NOW - 3 * MINUTE,
    status: "allowed",
    windows: [FIVE_HOUR, SEVEN_DAY],
    overage: { status: "rejected", disabledReason: "org_level_disabled" },
    ...overrides,
  }
}

function renderBar(state: UsageState, now = NOW, defaultOpen = false): string {
  const store = createUsageStore()
  if (state.connected) {
    store.receive(
      state.snapshot === null ? { kind: "empty" } : { kind: "snapshot", snapshot: state.snapshot },
    )
  }
  return renderToStaticMarkup(
    createElement(UsageBar, {
      store,
      loadReport: async (): Promise<UsageReportResult> => ({ ok: false, message: "" }),
      t,
      locale: "en-US",
      now,
      defaultOpen,
    }),
  )
}

const REPORT: UsageReport = {
  fetchedAt: NOW,
  limits: [
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 19,
      resetsAt: NOW + 3 * HOUR,
      scope: null,
      severity: "normal",
      isActive: true,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 2,
      resetsAt: NOW + 3 * HOUR,
      scope: { model: { displayName: "Fable" }, surface: null },
      severity: "normal",
      isActive: false,
    },
    {
      kind: "monthly_custom",
      group: "monthly",
      percent: 5,
      resetsAt: null,
      scope: null,
      severity: "critical",
      isActive: true,
    },
    {
      kind: "session",
      group: "session",
      percent: 40,
      resetsAt: NOW + 30 * MINUTE,
      scope: null,
      severity: "warning",
      isActive: true,
    },
  ],
  extraUsage: {
    isEnabled: true,
    monthlyLimit: 50,
    usedCredits: 12.5,
    utilization: 0.25,
    currency: "USD",
  },
}

function renderPopover(
  reportState: ReportView,
  snap: RateLimitSnapshot | null = snapshot(),
): string {
  return renderToStaticMarkup(
    createElement(UsagePopover, {
      snapshot: snap,
      now: NOW,
      t,
      locale: "en-US",
      report: reportState,
    }),
  )
}

describe("the usage bar", () => {
  it("renders nothing until the Host stream connects", () => {
    expect(renderBar({ connected: false, snapshot: null })).toBe("")
  })

  it("asks for a snapshot when connected with none", () => {
    const html = renderBar({ connected: true, snapshot: null })
    expect(html).toContain("Claude")
    expect(html).toContain("Usage — fetched on the next Claude call")
  })

  it("shows the five-hour window first and the other window after it", () => {
    const html = renderBar({ connected: true, snapshot: snapshot() })
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-window="five_hour"')
    expect(html).toContain("5-hour")
    expect(html).toContain("42% · in 2h 13m")
    expect(html).toContain('data-window="seven_day"')
    expect(html).toContain("Week")
    expect(html).toContain("18% · 11/23 19:59")
    expect(html).toContain("dsh-cu-secondary")
  })

  it("uses the seven-day window first when the account has no five-hour window", () => {
    const html = renderBar({
      connected: true,
      snapshot: snapshot({ windows: [SEVEN_DAY] }),
    })
    expect(html).toContain('data-window="seven_day"')
    expect(html).not.toContain("dsh-cu-secondary")
  })

  it("shows the limit-reached text for a rejected primary window", () => {
    const rejected = {
      ...FIVE_HOUR,
      status: "rejected" as const,
      resetsAt: NOW + HOUR + 5 * MINUTE,
    }
    const html = renderBar({
      connected: true,
      snapshot: snapshot({ status: "rejected", windows: [rejected] }),
    })
    expect(html).toContain("Limit reached · resets in 1h 05m")
    expect(html).toContain("dsh-cu-tone-error")
    expect(html).not.toContain(">42%<")
  })

  it("uses days and hours for a long reset time", () => {
    const distant = {
      ...FIVE_HOUR,
      resetsAt: NOW + 4 * 24 * HOUR + 6 * HOUR,
    }
    const html = renderBar({
      connected: true,
      snapshot: snapshot({ windows: [distant] }),
    })
    expect(html).toContain("42% · in 4d 6h")
  })

  it("marks a warning window", () => {
    const warning = { ...FIVE_HOUR, status: "allowed_warning" as const }
    const html = renderBar({
      connected: true,
      snapshot: snapshot({ status: "allowed_warning", windows: [warning] }),
    })
    expect(html).toContain("dsh-cu-tone-warning")
  })

  it("never assumes a passed reset is zero percent", () => {
    const passed = { ...FIVE_HOUR, resetsAt: NOW - 1_000, utilization: 0.5 }
    const html = renderBar({
      connected: true,
      snapshot: snapshot({ windows: [passed] }),
    })
    expect(html).toContain("Reset (not updated yet)")
    expect(html).not.toContain("50%")
  })

  it("renders the popover only inside the bar when open", () => {
    const html = renderBar({ connected: true, snapshot: snapshot() })
    expect(html).not.toContain('data-usage-popover=""')
  })

  it("opens the details before the first snapshot", () => {
    const html = renderBar({ connected: true, snapshot: null }, NOW, true)
    expect(html).toContain('data-usage-popover=""')
    expect(html).toContain("Usage — fetched on the next Claude call")
    expect(html).toContain("Usage by model (weekly)")
  })
})

describe("the usage popover", () => {
  it("shows the windows, overage, age and the model report", () => {
    const html = renderPopover({ status: "ready", report: REPORT })
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Claude usage"')
    expect(html).toContain("Rate limits")
    expect(html).toContain("5-hour")
    expect(html).toContain("42%")
    expect(html).toContain("18%")
    expect(html).toContain("Overage")
    expect(html).toContain("Status: Unavailable")
    expect(html).toContain("Disabled reason: org_level_disabled")
    expect(html).toContain("Updated 3 min ago (last Claude call)")
    expect(html).toContain("Usage by model (weekly)")
    expect(html).toContain("Weekly (all models)")
    expect(html).toContain("Weekly (Fable)")
    expect(html).toContain("monthly_custom")
    expect(html).toContain("5-hour")
    expect(html).toContain("dsh-cu-tone-error")
    expect(html).toContain("dsh-cu-tone-warning")
    expect(html).toContain("Extra usage 12.5 / 50 USD")
  })

  it("shows a passed reset instead of a percentage", () => {
    const passed = { ...FIVE_HOUR, resetsAt: NOW - 1_000, utilization: 0.5 }
    const html = renderPopover({ status: "ready", report: REPORT }, snapshot({ windows: [passed] }))
    expect(html).toContain("Reset (not updated yet)")
    expect(html).not.toContain(">50%<")
  })

  it("shows the report before the first snapshot", () => {
    const html = renderPopover({ status: "ready", report: REPORT }, null)
    expect(html).toContain("Usage — fetched on the next Claude call")
    expect(html).toContain("Usage by model (weekly)")
    expect(html).toContain("Weekly (all models)")
    expect(html).not.toContain("Rate limits")
    expect(html).not.toContain("Updated")
  })

  it("writes the just-now updated line without a duplicate ago", () => {
    const html = renderPopover(
      { status: "ready", report: REPORT },
      snapshot({ observedAt: NOW - 20_000 }),
    )
    expect(html).toContain("Updated just now (last Claude call)")
    expect(html).not.toContain("just now ago")
  })

  it("shows a loading state", () => {
    expect(renderPopover({ status: "loading" })).toContain("Loading…")
  })

  it("shows an error state with the Host's message", () => {
    const html = renderPopover({ status: "error", message: "usage probe failed" })
    expect(html).toContain("Could not load the usage report")
    expect(html).toContain("usage probe failed")
  })

  it("labels a warning overage as near the limit", () => {
    const snap = snapshot({ overage: { status: "allowed_warning" } })
    const html = renderPopover({ status: "ready", report: REPORT }, snap)
    expect(html).toContain("Status: Near limit")
  })

  it("keeps an overage without a reason compact", () => {
    const snap = snapshot({
      overage: { status: "allowed", resetsAt: NOW + HOUR },
    })
    const html = renderPopover({ status: "ready", report: REPORT }, snap)
    expect(html).toContain("Overage")
    expect(html).toContain("Status: Available")
    expect(html).not.toContain("Disabled reason")
  })
})
