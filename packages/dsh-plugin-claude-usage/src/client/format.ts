import type {
  RateLimitSnapshot,
  RateLimitStatus,
  RateLimitWindow,
  UsageExtraUsage,
  UsageLimit,
  UsageLimitScope,
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

/** A compact time left: `4d 6h`, `2h 13m` or `13m`. */
export function formatTimeShort(ms: number, t: Translate): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000))
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours >= 24) {
    return t("time.short.daysHours", {
      days: Math.floor(totalHours / 24),
      hours: totalHours % 24,
    })
  }
  if (totalHours > 0) {
    return t("time.short.hoursMinutes", { hours: totalHours, minutes: padded(totalMinutes % 60) })
  }
  return t("time.short.minutes", { minutes: totalMinutes })
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

/** A compact age for an age of at least a minute: `3m`, `2h` or `2d`. */
export function formatAge(ms: number, t: Translate): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000))
  if (minutes < 60) return t("age.minutes", { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("age.hours", { hours })
  return t("age.days", { days: Math.floor(hours / 24) })
}

/** The bar tooltip's updated line, with its own template for `just now`. */
export function formatTooltipUpdated(observedAt: number, now: number, t: Translate): string {
  const age = Math.max(0, now - observedAt)
  if (age < 60_000) return t("bar.tooltip.updatedJustNow")
  return t("bar.tooltip.updated", { age: formatAge(age, t) })
}

function scopeName(scope: UsageLimitScope | null): string | undefined {
  return scope?.model?.displayName ?? scope?.surface?.displayName
}

/** A short label for one `/usage` meter. Unknown kinds stay as they are. */
export function limitLabel(limit: UsageLimit, t: Translate): string {
  if (limit.kind === "session") return t("window.fiveHour")
  if (limit.kind === "weekly_all") return t("window.week")
  if (limit.kind === "weekly_scoped") {
    return scopeName(limit.scope) ?? limit.kind
  }
  return limit.kind
}

/** The compact extra-usage value: `12.5/50 USD`. */
export function extraUsageValue(extra: UsageExtraUsage, t: Translate): string {
  return t("extra.value", {
    used: extra.usedCredits === null ? t("value.unknown") : String(extra.usedCredits),
    limit: extra.monthlyLimit === null ? t("value.unknown") : String(extra.monthlyLimit),
    currency: extra.currency ?? t("value.unknown"),
  })
}
