/** `allowed_warning` means the account is near the limit of that window. */
export type RateLimitStatus = "allowed" | "allowed_warning" | "rejected"

/** One usage window of the unified rate limit, as the response headers report it. */
export interface RateLimitWindow {
  kind: "five_hour" | "seven_day"
  /** Fraction of the window used, from 0 to 1. */
  utilization: number
  /** When the window resets, in epoch milliseconds. */
  resetsAt: number
  status?: RateLimitStatus
}

export interface RateLimitOverage {
  status: RateLimitStatus
  /** When overage usage is available again, in epoch milliseconds. */
  resetsAt?: number
  disabledReason?: string
}

/** The unified rate limit headers of one Claude response. */
export interface RateLimitSnapshot {
  /** When the response headers arrived, in epoch milliseconds. */
  observedAt: number
  status: RateLimitStatus
  /** Reset time of the representative claim, in epoch milliseconds. */
  resetsAt?: number
  representativeClaim?: string
  /** Present windows only, in the order five_hour then seven_day. */
  windows: readonly RateLimitWindow[]
  overage?: RateLimitOverage
  /** Fraction of the limit that falls back to another backend, from 0 to 1. */
  fallbackPercentage?: number
}

export interface UsageLimitScopeName {
  displayName: string
}

export interface UsageLimitScope {
  model: UsageLimitScopeName | null
  surface: UsageLimitScopeName | null
}

/** One meter of the `/usage` report. Unknown kinds and severities are kept as they are. */
export interface UsageLimit {
  kind: string
  group: string
  /** Percent used, from 0 to 100. */
  percent: number
  /** Reset time in epoch milliseconds, or null when the server sends none. */
  resetsAt: number | null
  scope: UsageLimitScope | null
  severity: string
  isActive: boolean
}

export interface UsageExtraUsage {
  isEnabled: boolean
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null
  currency: string | null
}

export interface UsageReport {
  /** When the report arrived, in epoch milliseconds. */
  fetchedAt: number
  limits: readonly UsageLimit[]
  extraUsage: UsageExtraUsage
}

/** The Host service `claudeSubscriptionUsage` this plugin provides. */
export interface ClaudeSubscriptionUsage {
  current(): RateLimitSnapshot | null
  subscribe(listener: (snapshot: RateLimitSnapshot) => void): () => void
  fetchReport(signal?: AbortSignal): Promise<UsageReport>
}
