import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { en } from "../src/client/i18n"
import { createUsageStore } from "../src/client/store"
import type { ReportView, UsageState } from "../src/client/types"
import { UsageFooter } from "../src/client/UsageFooter"
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
    ...overrides,
  }
}

function renderFooter(state: UsageState, wide = true, now = NOW, defaultOpen = false): string {
  const store = createUsageStore()
  if (state.connected) {
    store.receive(
      state.snapshot === null ? { kind: "empty" } : { kind: "snapshot", snapshot: state.snapshot },
    )
  }
  return renderToStaticMarkup(
    createElement(UsageFooter, {
      wide,
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

function renderPopover(reportState: ReportView): string {
  return renderToStaticMarkup(
    createElement(UsagePopover, {
      now: NOW,
      t,
      locale: "en-US",
      report: reportState,
    }),
  )
}

describe("the sidebar footer row", () => {
  it("renders nothing until the Host stream connects", () => {
    expect(renderFooter({ connected: false, snapshot: null })).toBe("")
  })

  it("shows the mark and a dash before the first snapshot", () => {
    const html = renderFooter({ connected: true, snapshot: null })
    expect(html).toContain('aria-label="Claude usage"')
    expect(html).toContain('class="dsh-cu-mark"')
    expect(html).toContain('width="16"')
    expect(html).toContain('height="16"')
    expect(html).toContain(">—<")
  })

  it("shows the five-hour window first and the seven-day percent after it", () => {
    const html = renderFooter({ connected: true, snapshot: snapshot() })
    expect(html).not.toContain('data-rail=""')
    expect(html).toContain("dsh-cu-footer-primary")
    expect(html).toContain('class="dsh-cu-label">5h<')
    expect(html).toContain('class="dsh-cu-percent">42%<')
    expect(html).toContain('class="dsh-cu-when">2h 13m<')
    expect(html).toContain("dsh-cu-footer-secondary")
    expect(html).toContain("· 7d 18%")
    expect(html.indexOf(">5h<")).toBeLessThan(html.indexOf("· 7d"))
    expect(html).not.toContain("Week")
    expect(html).not.toContain("5-hour")
  })

  it("uses the seven-day window first when the account has no five-hour window", () => {
    const html = renderFooter({ connected: true, snapshot: snapshot({ windows: [SEVEN_DAY] }) })
    expect(html).toContain('class="dsh-cu-label">7d<')
    expect(html).not.toContain("dsh-cu-footer-secondary")
  })

  it("keeps the error color and the time left for a rejected window", () => {
    const rejected = {
      ...FIVE_HOUR,
      status: "rejected" as const,
      resetsAt: NOW + HOUR + 5 * MINUTE,
    }
    const html = renderFooter({
      connected: true,
      snapshot: snapshot({ status: "rejected", windows: [rejected] }),
    })
    expect(html).toContain("dsh-cu-tone-error")
    expect(html).toContain('class="dsh-cu-percent">42%<')
    expect(html).toContain('class="dsh-cu-when">1h 05m<')
    expect(html).not.toContain("Limit reached")
  })

  it("uses days and hours for a long reset time", () => {
    const distant = { ...FIVE_HOUR, resetsAt: NOW + 4 * 24 * HOUR + 3 * HOUR }
    const html = renderFooter({ connected: true, snapshot: snapshot({ windows: [distant] }) })
    expect(html).toContain('class="dsh-cu-when">4d 3h<')
    expect(html).not.toContain("in 4d 3h")
  })

  it("shows a dash for a passed reset instead of a percentage and time", () => {
    const passed = { ...FIVE_HOUR, resetsAt: NOW - 1_000, utilization: 0.5 }
    const html = renderFooter({ connected: true, snapshot: snapshot({ windows: [passed] }) })
    expect(html).toContain(">—<")
    expect(html).not.toContain(">50%<")
    expect(html).not.toContain("dsh-cu-when")
    expect(html).not.toContain("dsh-cu-percent")
  })

  it("puts each window and the update age in the button tooltip", () => {
    const html = renderFooter({ connected: true, snapshot: snapshot() })
    expect(html).toContain("5h 42% · 11/23 21:13")
    expect(html).toContain("7d 18% · 11/23 19:59")
    expect(html).toContain("updated 3m ago")
  })

  it("shows a ring and no text in the rail", () => {
    const html = renderFooter({ connected: true, snapshot: snapshot() }, false)
    expect(html).toContain('data-rail=""')
    expect(html).toContain("dsh-cu-ring")
    expect(html).toContain("dsh-cu-ring-cell")
    expect(html).toContain('aria-label="Claude usage"')
    expect(html).not.toContain("dsh-cu-footer-text")
    expect(html).not.toContain("dsh-cu-label")
    expect(html).not.toContain("dsh-cu-percent")
    expect(html).toContain("5h 42% · 11/23 21:13")
  })

  it("renders the popover only while it is open", () => {
    expect(renderFooter({ connected: true, snapshot: snapshot() })).not.toContain(
      'data-usage-popover=""',
    )
    expect(renderFooter({ connected: true, snapshot: snapshot() }, true, NOW, true)).toContain(
      'data-usage-popover=""',
    )
  })
})

describe("the usage popover", () => {
  it("lists the report rows in server order without headings or prose", () => {
    const html = renderPopover({ status: "ready", report: REPORT })
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Claude usage"')
    expect(html).toContain('class="dsh-cu-material" aria-hidden="true"')
    expect(html).not.toContain("dsh-cu-title")
    expect(html).not.toContain("Rate limits")
    expect(html).not.toContain("Usage by model")
    expect(html).not.toContain("Weekly")
    expect(html).not.toContain("Allowed")
    expect(html).not.toContain("Updated")

    expect(html).toContain('class="dsh-cu-row-name">7d<')
    expect(html).toContain('class="dsh-cu-row-name">Fable<')
    expect(html).toContain('class="dsh-cu-row-name">monthly_custom<')
    expect(html).toContain('class="dsh-cu-row-name">5h<')
    expect(html.indexOf(">7d<")).toBeLessThan(html.indexOf(">Fable<"))

    expect(html).toContain('class="dsh-cu-row-value">19%<')
    expect(html).toContain('class="dsh-cu-row-when">3h 00m<')
    expect(html).toContain('class="dsh-cu-row-value">2%<')
    expect(html).toContain('class="dsh-cu-row-value">5%<')
    expect(html).toContain('class="dsh-cu-row-when">—<')
    expect(html).toContain('class="dsh-cu-row-value">40%<')
    expect(html).toContain('class="dsh-cu-row-when">30m<')
    expect(html).toContain("dsh-cu-tone-error")
    expect(html).toContain("dsh-cu-tone-warning")
  })

  it("keeps each absolute reset in the row tooltip", () => {
    const html = renderPopover({ status: "ready", report: REPORT })
    expect(html).toContain('title="11/23 22:00"')
    expect(html).toContain('title="11/23 19:30"')
  })

  it("shows the extra usage as one compact row when it is enabled", () => {
    const html = renderPopover({ status: "ready", report: REPORT })
    expect(html).toContain('class="dsh-cu-row dsh-cu-extra"')
    expect(html).toContain('class="dsh-cu-row-name">Extra<')
    expect(html).toContain('class="dsh-cu-row-value">12.5/50 USD<')
  })

  it("shows no extra row when extra usage is disabled", () => {
    const report = {
      ...REPORT,
      extraUsage: { ...REPORT.extraUsage, isEnabled: false },
    }
    expect(renderPopover({ status: "ready", report })).not.toContain("Extra")
  })

  it("shows a single muted ellipsis while loading", () => {
    const html = renderPopover({ status: "loading" })
    expect(html).toContain('class="dsh-cu-muted"')
    expect(html).toContain("…")
    expect(html).not.toContain("dsh-cu-row")
  })

  it("shows a single muted mark with the message in its tooltip on error", () => {
    const html = renderPopover({ status: "error", message: "usage probe failed" })
    expect(html).toContain('class="dsh-cu-muted"')
    expect(html).toContain(">!<")
    expect(html).toContain('title="usage probe failed"')
    expect(html).not.toContain("Could not load")
  })

  it("shows the report even before the first snapshot", () => {
    const html = renderPopover({ status: "ready", report: REPORT })
    expect(html).toContain('class="dsh-cu-row-name">7d<')
    expect(html).not.toContain("42%")
    expect(html).not.toContain("18%")
  })
})
