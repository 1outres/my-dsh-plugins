import type { UsageExtraUsage, UsageLimit, UsageReport } from "../shared/contract"
import {
  extraUsageValue,
  formatAbsoluteReset,
  formatTimeShort,
  limitLabel,
  toneOfSeverity,
} from "./format"
import type { PopoverPosition } from "./popover-position"
import type { ReportView, Translate } from "./types"

export interface UsagePopoverProps {
  now: number
  t: Translate
  locale?: string
  report: ReportView
  position?: PopoverPosition | null
}

function toneWidth(percent: number): string {
  return `${Math.max(0, Math.min(100, percent))}%`
}

function rowKey(limit: UsageLimit): string {
  return [
    limit.kind,
    limit.group,
    limit.scope?.model?.displayName ?? "",
    limit.scope?.surface?.displayName ?? "",
    limit.resetsAt ?? "",
  ].join(":")
}

function LimitRow({
  limit,
  now,
  t,
  locale,
}: {
  limit: UsageLimit
  now: number
  t: Translate
  locale?: string
}): React.JSX.Element {
  const percent = Math.round(limit.percent)
  const passed = limit.resetsAt !== null && limit.resetsAt <= now
  const none = t("value.none")
  const when = limit.resetsAt === null || passed ? none : formatTimeShort(limit.resetsAt - now, t)
  const title = limit.resetsAt === null ? undefined : formatAbsoluteReset(limit.resetsAt, locale)
  return (
    <div
      className={`dsh-cu-row dsh-cu-tone-${toneOfSeverity(limit.severity)}`}
      data-limit={limit.kind}
      title={title}
    >
      <span className="dsh-cu-row-name">{limitLabel(limit, t)}</span>
      <span className="dsh-cu-meter">
        <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
      </span>
      <span className="dsh-cu-row-value">{passed ? none : `${percent}%`}</span>
      <span className="dsh-cu-row-when">{when}</span>
    </div>
  )
}

function ExtraRow({ extra, t }: { extra: UsageExtraUsage; t: Translate }): React.JSX.Element {
  const percent = extra.utilization === null ? null : Math.round(extra.utilization * 100)
  return (
    <div className="dsh-cu-row dsh-cu-extra" data-extra="">
      <span className="dsh-cu-row-name">{t("extra.label")}</span>
      <span className="dsh-cu-meter">
        {percent === null ? null : (
          <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
        )}
      </span>
      <span className="dsh-cu-row-value">{extraUsageValue(extra, t)}</span>
    </div>
  )
}

function ReportBody({
  report,
  now,
  t,
  locale,
}: {
  report: UsageReport
  now: number
  t: Translate
  locale?: string
}): React.JSX.Element {
  return (
    <>
      {report.limits.map((limit) => (
        <LimitRow key={rowKey(limit)} limit={limit} now={now} t={t} locale={locale} />
      ))}
      {report.extraUsage.isEnabled ? <ExtraRow extra={report.extraUsage} t={t} /> : null}
    </>
  )
}

export function UsagePopover({
  now,
  t,
  locale,
  report,
  position,
}: UsagePopoverProps): React.JSX.Element {
  return (
    <div
      className="dsh-cu-popover"
      role="dialog"
      aria-label={t("popover.title")}
      data-usage-popover=""
      style={position === undefined || position === null ? undefined : position}
    >
      <span className="dsh-cu-material" aria-hidden="true" />
      <div className="dsh-cu-popover-body">
        {report.status === "loading" ? (
          <div className="dsh-cu-muted" data-report="loading">
            …
          </div>
        ) : null}
        {report.status === "error" ? (
          <div
            className="dsh-cu-muted"
            data-report="error"
            title={
              report.message === undefined || report.message === "" ? undefined : report.message
            }
          >
            !
          </div>
        ) : null}
        {report.status === "ready" ? (
          <ReportBody report={report.report} now={now} t={t} locale={locale} />
        ) : null}
      </div>
    </div>
  )
}
