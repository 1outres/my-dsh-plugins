import { type Context, Service } from "@deepseek-ai/cordis"
import type { ClaudeSubscriptionUsage, RateLimitSnapshot, UsageReport } from "./contract"
import { createUsageStore, type UsageStore } from "./store"

export const USAGE_SERVICE = "claudeSubscriptionUsage"

/** Cordis calls these methods with its service proxy as `this`, where a private field throws. */
const STORE = Symbol("claudeSubscriptionUsageStore")
const REPORT = Symbol("claudeSubscriptionUsageReport")

/**
 * Host service `claudeSubscriptionUsage`: the latest rate limit snapshot and the
 * `/usage` report. It holds no network or process state of its own.
 */
export class ClaudeSubscriptionUsageService extends Service implements ClaudeSubscriptionUsage {
  [STORE]: UsageStore;
  [REPORT]: (signal?: AbortSignal) => Promise<UsageReport>

  constructor(
    ctx: Context,
    report: (signal?: AbortSignal) => Promise<UsageReport>,
    store: UsageStore = createUsageStore(),
  ) {
    super(ctx, USAGE_SERVICE)
    this[REPORT] = report
    this[STORE] = store
  }

  current(): RateLimitSnapshot | null {
    return this[STORE].current()
  }

  subscribe(listener: (snapshot: RateLimitSnapshot) => void): () => void {
    return this[STORE].subscribe(listener)
  }

  record(snapshot: RateLimitSnapshot): void {
    this[STORE].record(snapshot)
  }

  fetchReport(signal?: AbortSignal): Promise<UsageReport> {
    return this[REPORT](signal)
  }
}
