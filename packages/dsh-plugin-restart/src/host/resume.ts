import type { Clock, LoggerPort, ResumeRecord, ResumeSessionPort, ResumeStore } from "../contract"

/** One minute in milliseconds. */
const MINUTE_MS = 60_000

export interface ResumeOptions {
  readonly store: ResumeStore
  readonly sessions: ResumeSessionPort
  readonly clock: Clock
  readonly withinMinutes: number
  readonly logger: LoggerPort
}

export type ResumeOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "expired"; readonly record: ResumeRecord }
  | { readonly kind: "missing"; readonly record: ResumeRecord; readonly reason: string }
  | { readonly kind: "resumed"; readonly record: ResumeRecord }

/**
 * Continue the session that asked for the restart, then drop the request.
 *
 * The record is deleted before anything else, so a crash during the resume
 * cannot loop the same message on every startup.
 * @param options - stored request, session lookup, clock, and log.
 * @returns what happened, for the caller's log.
 */
export async function resumeAfterStartup(options: ResumeOptions): Promise<ResumeOutcome> {
  const record = options.store.read()
  if (record === undefined) return { kind: "none" }
  await options.store.clear()
  const now = options.clock()
  if (now - record.requestedAt > options.withinMinutes * MINUTE_MS) {
    options.logger.warn(
      `dropping the resume request of session ${record.sessionId}: it is older than ${options.withinMinutes} minutes`,
    )
    return { kind: "expired", record }
  }
  const resolved = await options.sessions.resolve(record.sessionId)
  if (resolved.kind === "missing") {
    options.logger.warn(`cannot resume session ${record.sessionId}: ${resolved.reason}`)
    return { kind: "missing", record, reason: resolved.reason }
  }
  resolved.deliver.followup(resumeMessage(record, new Date(now).toISOString()))
  options.logger.info(`resumed session ${record.sessionId} after the restart`)
  return { kind: "resumed", record }
}

/**
 * Build the message that wakes the session after the restart.
 * @param record - the stored request, with its optional note.
 * @param at - ISO time of the resume.
 * @returns the user message text.
 */
export function resumeMessage(record: ResumeRecord, at: string): string {
  const note = record.note?.trim() ?? ""
  return [
    `DeepSeek Harness finished restarting at ${at}. This session asked for that restart.`,
    ...(note === "" ? [] : [`What you wrote before the restart: ${note}`]),
    "Continue the task you were working on.",
  ].join("\n\n")
}
