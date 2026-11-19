import type {
  RateLimitOverage,
  RateLimitSnapshot,
  RateLimitStatus,
  RateLimitWindow,
} from "./contract"

/** The response headers a relay sees, with names as Node lowercases them. */
export type HeaderSource = Readonly<Record<string, string | readonly string[] | undefined>>

const PREFIX = "anthropic-ratelimit-unified-"
const STATUSES: ReadonlySet<string> = new Set(["allowed", "allowed_warning", "rejected"])

function headerValue(headers: ReadonlyMap<string, string>, name: string): string | undefined {
  const value = headers.get(`${PREFIX}${name}`)?.trim()
  return value === undefined || value === "" ? undefined : value
}

function normalize(headers: HeaderSource): ReadonlyMap<string, string> {
  const normalized = new Map<string, string>()
  for (const [name, raw] of Object.entries(headers)) {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value === "string") normalized.set(name.toLowerCase(), value)
  }
  return normalized
}

function statusOf(value: string | undefined): RateLimitStatus | undefined {
  return value !== undefined && STATUSES.has(value) ? (value as RateLimitStatus) : undefined
}

function secondsToMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

function fraction(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function windowOf(
  kind: RateLimitWindow["kind"],
  utilizationValue: string | undefined,
  resetValue: string | undefined,
  statusValue: string | undefined,
): RateLimitWindow | null {
  const utilization = fraction(utilizationValue)
  const resetsAt = secondsToMs(resetValue)
  if (utilization === undefined || resetsAt === undefined) return null
  const status = statusOf(statusValue)
  return { kind, utilization, resetsAt, ...(status === undefined ? {} : { status }) }
}

function overageOf(headers: ReadonlyMap<string, string>): RateLimitOverage | undefined {
  const status = statusOf(headerValue(headers, "overage-status"))
  if (status === undefined) return undefined
  const resetsAt = secondsToMs(headerValue(headers, "overage-reset"))
  const disabledReason = headerValue(headers, "overage-disabled-reason")
  return {
    status,
    ...(resetsAt === undefined ? {} : { resetsAt }),
    ...(disabledReason === undefined ? {} : { disabledReason }),
  }
}

function hasUnifiedHeaders(headers: ReadonlyMap<string, string>): boolean {
  for (const name of headers.keys()) if (name.startsWith(PREFIX)) return true
  return false
}

/**
 * Reads the unified rate limit headers. A field that does not parse is treated as
 * absent, so a window appears only when both its utilization and its reset do.
 * Returns null when the response carries no unified headers or no valid status.
 */
export function parseRateLimitSnapshot(
  headers: HeaderSource,
  observedAt: number,
): RateLimitSnapshot | null {
  const normalized = normalize(headers)
  if (!hasUnifiedHeaders(normalized)) return null
  const status = statusOf(headerValue(normalized, "status"))
  if (status === undefined) return null
  const windows = [
    windowOf(
      "five_hour",
      headerValue(normalized, "5h-utilization"),
      headerValue(normalized, "5h-reset"),
      headerValue(normalized, "5h-status"),
    ),
    windowOf(
      "seven_day",
      headerValue(normalized, "7d-utilization"),
      headerValue(normalized, "7d-reset"),
      headerValue(normalized, "7d-status"),
    ),
  ].filter((window): window is RateLimitWindow => window !== null)
  const resetsAt = secondsToMs(headerValue(normalized, "reset"))
  const representativeClaim = headerValue(normalized, "representative-claim")
  const fallbackPercentage = fraction(headerValue(normalized, "fallback-percentage"))
  const overage = overageOf(normalized)
  return {
    observedAt,
    status,
    ...(resetsAt === undefined ? {} : { resetsAt }),
    ...(representativeClaim === undefined ? {} : { representativeClaim }),
    windows,
    ...(overage === undefined ? {} : { overage }),
    ...(fallbackPercentage === undefined ? {} : { fallbackPercentage }),
  }
}
