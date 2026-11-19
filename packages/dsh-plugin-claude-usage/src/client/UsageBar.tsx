import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { RateLimitWindow, UsageReportResult } from "../shared/contract"
import {
  formatAbsoluteReset,
  formatTimeShort,
  formatTooltipUpdated,
  orderedWindows,
  percentOf,
  primaryWindow,
  toneOfStatus,
  windowLabel,
} from "./format"
import { createPositionTracker } from "./popover-position"
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

const useMeasureLayout = typeof window === "undefined" ? useEffect : useLayoutEffect

function toneWidth(percent: number): string {
  return `${Math.max(0, Math.min(100, percent))}%`
}

function WindowItem({
  window,
  primary,
  now,
  t,
}: {
  window: RateLimitWindow
  primary: boolean
  now: number
  t: Translate
}): React.JSX.Element {
  const percent = percentOf(window.utilization)
  const passed = window.resetsAt <= now
  return (
    <span
      className={`dsh-cu-item ${primary ? "dsh-cu-primary" : "dsh-cu-secondary"} dsh-cu-tone-${toneOfStatus(window.status)}`}
      data-window={window.kind}
    >
      <span className="dsh-cu-label">{windowLabel(window.kind, t)}</span>
      <span className="dsh-cu-meter">
        <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
      </span>
      {passed ? (
        <span className="dsh-cu-none">{t("value.none")}</span>
      ) : (
        <>
          <span className="dsh-cu-percent">{percent}%</span>
          {primary ? (
            <span className="dsh-cu-when">{formatTimeShort(window.resetsAt - now, t)}</span>
          ) : null}
        </>
      )}
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
  const [positionTracker] = useState(createPositionTracker)
  const position = useSyncExternalStore(
    positionTracker.subscribe,
    positionTracker.getSnapshot,
    positionTracker.getSnapshot,
  )
  const current = now ?? clock

  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setClock(Date.now()), REFRESH_MS)
    return () => clearInterval(timer)
  }, [now])

  useMeasureLayout(() => {
    if (!open) return
    const root = rootRef.current
    if (root === null) return
    return positionTracker.follow(root, window)
  }, [open, positionTracker])

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
  const tooltip =
    snapshot === null
      ? undefined
      : [
          ...windows.map((window) =>
            t("bar.tooltip.window", {
              label: windowLabel(window.kind, t),
              percent: percentOf(window.utilization),
              reset: formatAbsoluteReset(window.resetsAt, locale),
            }),
          ),
          formatTooltipUpdated(snapshot.observedAt, current, t),
        ].join("\n")

  return (
    <div className="dsh-cu-root" ref={rootRef}>
      <button
        type="button"
        className="dsh-cu-bar"
        aria-label={t("popover.title")}
        title={tooltip}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        data-usage-bar=""
      >
        <svg
          className="dsh-cu-mark"
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x="2.5"
            y="14.5"
            width="19"
            height="6"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M5.5 17.5h6.5M16.5 17.5h2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M12 2.6v5.2M9.4 4l5.2 2.4M14.6 4 9.4 6.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="12" cy="7.8" r="2.1" />
        </svg>
        {windows.length === 0 ? (
          <span className="dsh-cu-none">{t("value.none")}</span>
        ) : (
          <>
            {primary === null ? null : <WindowItem window={primary} primary now={current} t={t} />}
            {secondary.map((window) => (
              <WindowItem key={window.kind} window={window} primary={false} now={current} t={t} />
            ))}
          </>
        )}
      </button>
      {open ? (
        <UsagePopover now={current} t={t} locale={locale} report={report} position={position} />
      ) : null}
    </div>
  )
}
