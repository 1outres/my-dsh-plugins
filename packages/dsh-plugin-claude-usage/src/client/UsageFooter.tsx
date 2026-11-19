import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { RateLimitWindow, UsageReportResult } from "../shared/contract"
import {
  formatAbsoluteReset,
  formatTimeShort,
  formatTooltipUpdated,
  orderedWindows,
  percentOf,
  primaryWindow,
  type Tone,
  toneOfStatus,
  windowLabel,
} from "./format"
import { createPositionTracker } from "./popover-position"
import type { ReportView, Translate, UsageStore } from "./types"
import { UsagePopover } from "./UsagePopover"

export interface UsageFooterProps {
  /** False while the sidebar is the 56px rail. */
  wide: boolean
  store: UsageStore
  loadReport: () => Promise<UsageReportResult>
  t: Translate
  locale?: string
  /** Pin the clock in tests; the row refreshes it every 30 seconds otherwise. */
  now?: number
  /** Open the details on the first render, before the user selects the row. */
  defaultOpen?: boolean
}

const REFRESH_MS = 30_000

const useMeasureLayout = typeof window === "undefined" ? useEffect : useLayoutEffect

function toneWidth(percent: number): string {
  return `${Math.max(0, Math.min(100, percent))}%`
}

function Mark(): React.JSX.Element {
  return (
    <svg
      className="dsh-cu-mark"
      viewBox="0 0 24 24"
      width={16}
      height={16}
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
  )
}

function Meter({ percent }: { percent: number }): React.JSX.Element {
  return (
    <span className="dsh-cu-meter">
      <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
    </span>
  )
}

function PrimaryWindow({
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
  return (
    <span
      className={`dsh-cu-footer-primary dsh-cu-tone-${toneOfStatus(window.status)}`}
      data-window={window.kind}
    >
      <span className="dsh-cu-label">{windowLabel(window.kind, t)}</span>
      <Meter percent={percent} />
      {passed ? (
        <span className="dsh-cu-none">{t("value.none")}</span>
      ) : (
        <>
          <span className="dsh-cu-percent">{percent}%</span>
          <span className="dsh-cu-when">{formatTimeShort(window.resetsAt - now, t)}</span>
        </>
      )}
    </span>
  )
}

function SecondaryWindow({
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
  return (
    <span
      className={`dsh-cu-footer-secondary dsh-cu-tone-${toneOfStatus(window.status)}`}
      data-window={window.kind}
    >
      {passed
        ? `· ${windowLabel(window.kind, t)} ${t("value.none")}`
        : `· ${windowLabel(window.kind, t)} ${percent}%`}
    </span>
  )
}

function Ring({
  percent,
  tone,
  filled,
}: {
  percent: number
  tone: Tone
  filled: boolean
}): React.JSX.Element {
  return (
    <span className={`dsh-cu-ring-cell dsh-cu-tone-${tone}`}>
      <svg
        className="dsh-cu-ring"
        viewBox="0 0 16 16"
        width={16}
        height={16}
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="var(--dsw-alias-bg-layer-2)"
          strokeWidth="2"
        />
        {filled ? (
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            pathLength={100}
            strokeDasharray={`${Math.max(0, Math.min(100, percent))} 100`}
            strokeLinecap="round"
            transform="rotate(-90 8 8)"
          />
        ) : null}
      </svg>
    </span>
  )
}

export function UsageFooter({
  wide,
  store,
  loadReport,
  t,
  locale,
  now,
  defaultOpen = false,
}: UsageFooterProps): React.JSX.Element | null {
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
    const button = buttonRef.current
    if (button === null) return
    return positionTracker.follow(button, window, wide)
  }, [open, positionTracker, wide])

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
  const tone = primary === null ? "normal" : toneOfStatus(primary.status)
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
    <div className="dsh-cu-footer-root" ref={rootRef}>
      <button
        type="button"
        className={`dsh-cu-footer${wide ? "" : ` dsh-cu-tone-${tone}`}`}
        data-rail={wide ? undefined : ""}
        aria-label={t("popover.title")}
        title={tooltip}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
      >
        {wide ? (
          <>
            <Mark />
            <span className="dsh-cu-footer-text">
              {primary === null ? (
                <span className="dsh-cu-none">{t("value.none")}</span>
              ) : (
                <>
                  <PrimaryWindow window={primary} now={current} t={t} />
                  {secondary.map((window) => (
                    <SecondaryWindow key={window.kind} window={window} now={current} t={t} />
                  ))}
                </>
              )}
            </span>
          </>
        ) : (
          <Ring
            percent={primary === null ? 0 : percentOf(primary.utilization)}
            tone={tone}
            filled={primary !== null && primary.resetsAt > current}
          />
        )}
      </button>
      {open ? (
        <UsagePopover now={current} t={t} locale={locale} report={report} position={position} />
      ) : null}
    </div>
  )
}
