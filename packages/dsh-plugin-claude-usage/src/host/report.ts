import type { ClaudeSubscriptionUsage, UsageReportResult } from "../shared/contract"

/** Runs the provider's `/usage` report and turns a failure into a message. */
export async function reportResult(
  provider: ClaudeSubscriptionUsage,
  signal?: AbortSignal,
): Promise<UsageReportResult> {
  try {
    return { ok: true, report: await provider.fetchReport(signal) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
