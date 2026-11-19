/** The consumer side of the `claudeSubscriptionUsage` service, owned by claude-subscription. */
export type RateLimitStatus = "allowed" | "allowed_warning" | "rejected"

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
  resetsAt?: number
  disabledReason?: string
}

export interface RateLimitSnapshot {
  observedAt: number
  status: RateLimitStatus
  resetsAt?: number
  representativeClaim?: string
  windows: readonly RateLimitWindow[]
  overage?: RateLimitOverage
  fallbackPercentage?: number
}

export interface UsageLimitScopeName {
  displayName: string
}

export interface UsageLimitScope {
  model: UsageLimitScopeName | null
  surface: UsageLimitScopeName | null
}

export interface UsageLimit {
  kind: string
  group: string
  /** Percent used, from 0 to 100. */
  percent: number
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
  fetchedAt: number
  limits: readonly UsageLimit[]
  extraUsage: UsageExtraUsage
}

/** The Host service this plugin requires. */
export interface ClaudeSubscriptionUsage {
  current(): RateLimitSnapshot | null
  subscribe(listener: (snapshot: RateLimitSnapshot) => void): () => void
  fetchReport(signal?: AbortSignal): Promise<UsageReport>
}

/** One item of the `claudeUsage.snapshots` stream. */
export type UsageStreamState = { kind: "empty" } | { kind: "snapshot"; snapshot: RateLimitSnapshot }

/** The answer of `claudeUsage.report`. */
export type UsageReportResult = { ok: true; report: UsageReport } | { ok: false; message: string }
