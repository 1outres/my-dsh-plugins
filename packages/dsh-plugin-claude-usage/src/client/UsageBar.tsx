import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { RateLimitWindow, UsageReportResult } from "../shared/contract"
import {
  formatAbsoluteReset,
  formatLimitReached,
  formatTimeLeft,
  orderedWindows,
  percentOf,
  primaryWindow,
  toneOfStatus,
  windowLabel,
} from "./format"
import type { ReportView, Translate, UsageStore } from "./types"
import { UsagePopover } from "./UsagePopover"

export interface UsageBarProps {
  store: UsageStore
  loadReport: () => Promise<UsageReportResult>
  t: Translate
  locale?: string
  /** Pin the clock in tests; the bar refreshes it every 30 seconds otherwise. */
  now?: number
  /** Open the details on the first render, before the user selects the bar. */
  defaultOpen?: boolean
}

const REFRESH_MS = 30_000

function toneWidth(percent: number): string {
  return `${Math.max(0, Math.min(100, percent))}%`
}

function PrimaryItem({
  window,
  now,
  t,
}: {
  window: RateLimitWindow
  now: number
  t: Translate
}): React.JSX.Element {
  const percent = percentOf(window.utilization)
  const passed = window.resetsAt <= now
  const text = passed
    ? t("reset.passed")
    : window.status === "rejected"
      ? formatLimitReached(window.resetsAt - now, t)
      : `${percent}% · ${formatTimeLeft(window.resetsAt - now, t)}`
  return (
    <span
      className={`dsh-cu-item dsh-cu-primary dsh-cu-tone-${toneOfStatus(window.status)}`}
      data-window={window.kind}
    >
      <span className="dsh-cu-label">{windowLabel(window.kind, t)}</span>
      {passed ? null : (
        <span className="dsh-cu-meter">
          <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
        </span>
      )}
      <span className="dsh-cu-when">{text}</span>
    </span>
  )
}

function SecondaryItem({
  window,
  now,
  t,
  locale,
}: {
  window: RateLimitWindow
  now: number
  t: Translate
  locale?: string
}): React.JSX.Element {
  const percent = percentOf(window.utilization)
  const passed = window.resetsAt <= now
  return (
    <span
      className={`dsh-cu-item dsh-cu-secondary dsh-cu-tone-${toneOfStatus(window.status)}`}
      data-window={window.kind}
    >
      <span className="dsh-cu-label">{windowLabel(window.kind, t)}</span>
      {passed ? null : (
        <span className="dsh-cu-meter">
          <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
        </span>
      )}
      <span className="dsh-cu-when">
        {passed
          ? t("reset.passed")
          : `${percent}% · ${formatAbsoluteReset(window.resetsAt, locale)}`}
      </span>
    </span>
  )
}

export function UsageBar({
  store,
  loadReport,
  t,
  locale,
  now,
  defaultOpen = false,
}: UsageBarProps): React.JSX.Element | null {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [open, setOpen] = useState(defaultOpen)
  const [clock, setClock] = useState(() => Date.now())
  const [report, setReport] = useState<ReportView>({ status: "idle" })
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const current = now ?? clock

  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setClock(Date.now()), REFRESH_MS)
    return () => clearInterval(timer)
  }, [now])

  useEffect(() => {
    if (!open) return
    let active = true
    setReport({ status: "loading" })
    void loadReport().then((result) => {
      if (!active) return
      setReport(
        result.ok
          ? { status: "ready", report: result.report }
          : { status: "error", message: result.message },
      )
    })
    return () => {
      active = false
    }
  }, [open, loadReport])

  useEffect(() => {
    if (!open) return
    const close = (): void => {
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close()
    }
    const onPointer = (event: PointerEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) close()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  if (!state.connected) return null

  const snapshot = state.snapshot
  const windows = snapshot === null ? [] : orderedWindows(snapshot)
  const primary = snapshot === null ? null : primaryWindow(snapshot)
  const secondary = primary === null ? [] : windows.filter((window) => window.kind !== primary.kind)

  return (
    <div className="dsh-cu-root" ref={rootRef}>
      <button
        type="button"
        className="dsh-cu-bar"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        data-usage-bar=""
      >
        <span className="dsh-cu-brand" aria-hidden="true">
          ✳
        </span>
        <span className="dsh-cu-name">{t("brand")}</span>
        {snapshot === null ? (
          <span className="dsh-cu-pending">{t("usage.pending")}</span>
        ) : (
          <>
            {primary === null ? null : <PrimaryItem window={primary} now={current} t={t} />}
            {secondary.map((window) => (
              <SecondaryItem
                key={window.kind}
                window={window}
                now={current}
                t={t}
                locale={locale}
              />
            ))}
          </>
        )}
      </button>
      {open ? (
        <UsagePopover snapshot={snapshot} now={current} t={t} locale={locale} report={report} />
      ) : null}
    </div>
  )
}
