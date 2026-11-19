import type { RateLimitSnapshot, RateLimitWindow, UsageReport } from "../shared/contract"
import {
  extraUsageText,
  formatAbsoluteReset,
  formatTimeLeft,
  formatUpdated,
  groupLabel,
  groupLimits,
  limitLabel,
  orderedWindows,
  percentOf,
  statusLabel,
  toneOfSeverity,
  toneOfStatus,
  windowLabel,
} from "./format"
import type { PopoverPosition } from "./popover-position"
import type { ReportView, Translate } from "./types"

export interface UsagePopoverProps {
  snapshot: RateLimitSnapshot | null
  now: number
  t: Translate
  locale?: string
  report: ReportView
  position?: PopoverPosition | null
}

function toneWidth(percent: number): string {
  return `${Math.max(0, Math.min(100, percent))}%`
}

function WindowRow({
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
  const status = window.status === undefined ? "" : ` · ${statusLabel(window.status, t)}`
  return (
    <div
      className={`dsh-cu-row dsh-cu-tone-${toneOfStatus(window.status)}`}
      data-window={window.kind}
    >
      <div className="dsh-cu-row-head">
        <span className="dsh-cu-row-name">{windowLabel(window.kind, t)}</span>
        <span className="dsh-cu-row-value">{passed ? t("reset.passed") : `${percent}%`}</span>
      </div>
      {passed ? null : (
        <div className="dsh-cu-row-bar">
          <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
        </div>
      )}
      <div className="dsh-cu-row-meta">
        {formatAbsoluteReset(window.resetsAt, locale)}
        {passed ? "" : ` · ${formatTimeLeft(window.resetsAt - now, t)}`}
        {status}
      </div>
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
    <div className="dsh-cu-report">
      {groupLimits(report.limits).map((group) => (
        <div className="dsh-cu-group" key={group.group} data-group={group.group}>
          <div className="dsh-cu-group-title">{groupLabel(group.group, t)}</div>
          {group.limits.map((limit) => {
            const percent = Math.round(limit.percent)
            const passed = limit.resetsAt !== null && limit.resetsAt <= now
            const key = [
              limit.kind,
              limit.group,
              limit.scope?.model?.displayName ?? "",
              limit.scope?.surface?.displayName ?? "",
              limit.resetsAt ?? "",
            ].join(":")
            return (
              <div
                className={`dsh-cu-row dsh-cu-tone-${toneOfSeverity(limit.severity)}`}
                key={key}
                data-limit={limit.kind}
              >
                <div className="dsh-cu-row-head">
                  <span className="dsh-cu-row-name">{limitLabel(limit, t)}</span>
                  <span className="dsh-cu-row-value">
                    {passed ? t("reset.passed") : `${percent}%`}
                  </span>
                </div>
                {passed ? null : (
                  <div className="dsh-cu-row-bar">
                    <span className="dsh-cu-fill" style={{ width: toneWidth(percent) }} />
                  </div>
                )}
                {limit.resetsAt === null ? null : (
                  <div className="dsh-cu-row-meta">
                    {formatAbsoluteReset(limit.resetsAt, locale)}
                    {passed ? "" : ` · ${formatTimeLeft(limit.resetsAt - now, t)}`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {report.extraUsage.isEnabled ? (
        <div className="dsh-cu-extra">{extraUsageText(report, t)}</div>
      ) : null}
    </div>
  )
}

export function UsagePopover({
  snapshot,
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
      {snapshot === null ? (
        <div className="dsh-cu-pending">{t("usage.pending")}</div>
      ) : (
        <>
          <div className="dsh-cu-section-title">{t("popover.rateLimits")}</div>
          {orderedWindows(snapshot).map((window) => (
            <WindowRow key={window.kind} window={window} now={now} t={t} locale={locale} />
          ))}
          {snapshot.overage === undefined ? null : (
            <div className={`dsh-cu-overage dsh-cu-tone-${toneOfStatus(snapshot.overage.status)}`}>
              <div className="dsh-cu-section-title">{t("popover.overage")}</div>
              <div className="dsh-cu-row-meta">
                {t("popover.overageStatus", { status: statusLabel(snapshot.overage.status, t) })}
              </div>
              {snapshot.overage.disabledReason === undefined ? null : (
                <div className="dsh-cu-row-meta">
                  {t("popover.overageDisabled", { reason: snapshot.overage.disabledReason })}
                </div>
              )}
              {snapshot.overage.resetsAt === undefined ? null : (
                <div className="dsh-cu-row-meta">
                  {formatAbsoluteReset(snapshot.overage.resetsAt, locale)}
                  {snapshot.overage.resetsAt <= now
                    ? ` · ${t("reset.passed")}`
                    : ` · ${formatTimeLeft(snapshot.overage.resetsAt - now, t)}`}
                </div>
              )}
            </div>
          )}
          <div className="dsh-cu-updated">{formatUpdated(snapshot.observedAt, now, t)}</div>
        </>
      )}
      <div className="dsh-cu-section-title">{t("popover.byModel")}</div>
      {report.status === "loading" ? (
        <div className="dsh-cu-loading">{t("report.loading")}</div>
      ) : null}
      {report.status === "error" ? (
        <div className="dsh-cu-error">
          <div>{t("report.error")}</div>
          {report.message === undefined || report.message === "" ? null : (
            <div className="dsh-cu-error-detail">{report.message}</div>
          )}
        </div>
      ) : null}
      {report.status === "ready" ? (
        <ReportBody report={report.report} now={now} t={t} locale={locale} />
      ) : null}
    </div>
  )
}