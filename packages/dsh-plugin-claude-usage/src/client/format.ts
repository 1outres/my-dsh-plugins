import type {
  RateLimitSnapshot,
  RateLimitStatus,
  RateLimitWindow,
  UsageLimit,
  UsageLimitScope,
  UsageReport,
} from "../shared/contract"
import type { Translate } from "./types"

export type Tone = "normal" | "warning" | "error"

const WINDOW_ORDER: Readonly<Record<RateLimitWindow["kind"], number>> = {
  five_hour: 0,
  seven_day: 1,
}

export function orderedWindows(snapshot: RateLimitSnapshot): readonly RateLimitWindow[] {
  return [...snapshot.windows].sort(
    (left, right) => WINDOW_ORDER[left.kind] - WINDOW_ORDER[right.kind],
  )
}

/** The window shown first: five-hour when the account has it, otherwise seven-day. */
export function primaryWindow(snapshot: RateLimitSnapshot): RateLimitWindow | null {
  return orderedWindows(snapshot)[0] ?? null
}

export function percentOf(utilization: number): number {
  return Math.round(utilization * 100)
}

export function toneOfStatus(status: RateLimitStatus | undefined): Tone {
  if (status === "allowed_warning") return "warning"
  if (status === "rejected") return "error"
  return "normal"
}

export function toneOfSeverity(severity: string): Tone {
  if (severity === "warning") return "warning"
  if (severity === "critical") return "error"
  return "normal"
}

export function windowLabel(kind: RateLimitWindow["kind"], t: Translate): string {
  return kind === "five_hour" ? t("window.fiveHour") : t("window.week")
}

function padded(minutes: number): string {
  return String(minutes).padStart(2, "0")
}

/** A positive time left, such as `in 2h 13m`. */
export function formatTimeLeft(ms: number, t: Translate): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) {
    return t("time.left.hoursMinutes", { hours, minutes: padded(totalMinutes % 60) })
  }
  return t("time.left.minutes", { minutes: totalMinutes })
}

/** Text for a rejected primary window, such as `Limit reached · resets in 1h 05m`. */
export function formatLimitReached(ms: number, t: Translate): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) {
    return t("limit.reached.hours", { hours, minutes: padded(totalMinutes % 60) })
  }
  return t("limit.reached.minutes", { minutes: totalMinutes })
}

export function formatAbsoluteReset(epoch: number, locale?: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epoch))
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)
    if (part === undefined) throw new Error(`The date format has no ${type} part`)
    return part.value
  }
  return `${pick("month")}/${pick("day")} ${pick("hour")}:${pick("minute")}`
}

/** How long ago a snapshot arrived, such as `3 min`. */
export function formatAge(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return t("age.justNow")
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t("age.minutes", { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("age.hours", { hours })
  return t("age.days", { days: Math.floor(hours / 24) })
}

/** The popover's "Updated" line. `just now` has its own template, not an age suffix. */
export function formatUpdated(observedAt: number, now: number, t: Translate): string {
  const age = Math.max(0, now - observedAt)
  if (age < 60_000) return t("popover.updatedJustNow")
  return t("popover.updated", { age: formatAge(age, t) })
}

export function statusLabel(status: RateLimitStatus, t: Translate): string {
  if (status === "allowed_warning") return t("status.allowed_warning")
  if (status === "rejected") return t("status.rejected")
  return t("status.allowed")
}

function scopeName(scope: UsageLimitScope | null): string | undefined {
  return scope?.model?.displayName ?? scope?.surface?.displayName
}

export function limitLabel(limit: UsageLimit, t: Translate): string {
  if (limit.kind === "session") return t("limit.session")
  if (limit.kind === "weekly_all") return t("limit.weeklyAll")
  if (limit.kind === "weekly_scoped") {
    const name = scopeName(limit.scope)
    return name === undefined ? limit.kind : t("limit.weeklyScoped", { name })
  }
  return limit.kind
}

export function groupLabel(group: string, t: Translate): string {
  if (group === "session") return t("group.session")
  if (group === "weekly") return t("group.weekly")
  return group
}

export interface LimitGroup {
  group: string
  limits: readonly UsageLimit[]
}

/** The server's order of groups and of the limits inside each group. */
export function groupLimits(limits: readonly UsageLimit[]): readonly LimitGroup[] {
  const groups = new Map<string, UsageLimit[]>()
  for (const limit of limits) {
    const existing = groups.get(limit.group)
    if (existing === undefined) groups.set(limit.group, [limit])
    else existing.push(limit)
  }
  return [...groups].map(([group, grouped]) => ({ group, limits: grouped }))
}

export function extraUsageText(report: UsageReport, t: Translate): string {
  const { usedCredits, monthlyLimit, currency } = report.extraUsage
  return t("extra.usage", {
    used: usedCredits === null ? t("value.unknown") : String(usedCredits),
    limit: monthlyLimit === null ? t("value.unknown") : String(monthlyLimit),
    currency: currency ?? t("value.unknown"),
  })
}
