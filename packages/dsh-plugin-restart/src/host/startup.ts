import type { LoggerPort, ResumeSessionPort } from "../contract"

/** Where the startup signals come from. */
export interface StartupSignals {
  /** Ask for one callback when startup is committed; a late listener runs at once. */
  readonly onReady: (listener: () => void) => void
  /** Ask for one callback when the optional session controller exists. */
  readonly onSessions: (listener: (sessions: ResumeSessionPort) => void) => void
  /** The work that runs once both signals arrived. */
  readonly run: (sessions: ResumeSessionPort) => Promise<void>
  readonly logger: LoggerPort
}

/**
 * Run one task after readiness and the session controller are both there.
 * @param signals - the two subscriptions and the work they unlock.
 */
export function startAfterStartup(signals: StartupSignals): void {
  let ready = false
  let sessions: ResumeSessionPort | undefined
  let started = false

  const start = (): void => {
    if (started || !ready || sessions === undefined) return
    started = true
    void signals.run(sessions).catch((error: unknown) => {
      signals.logger.warn(`could not resume the session after the restart: ${String(error)}`)
    })
  }

  signals.onReady(() => {
    ready = true
    start()
  })
  signals.onSessions((resolved) => {
    sessions = resolved
    start()
  })
}
