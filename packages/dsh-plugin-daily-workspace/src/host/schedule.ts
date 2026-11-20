import type { ClockPort, LoggerPort, TimerPort } from "../contract"
import { errorMessage } from "./error"
import { localDateKey, msUntilNextLocalDay } from "./paths"

/** How often the schedule wakes to look at the local date. */
export const CHECK_INTERVAL_MS = 5 * 60 * 1000

export interface SchedulePorts {
  readonly clock: ClockPort
  readonly timer: TimerPort
  readonly logger: LoggerPort
  /** One registration pass for the local date of `date`. */
  run(date: Date): Promise<void>
}

/**
 * Run once now, then check the local date every few minutes and run when it
 * changed, one pass at a time. A trigger that arrives during a pass waits for
 * it.
 * @returns a function that cancels the pending check.
 */
export function startDailySchedule(ports: SchedulePorts): () => void {
  let stopped = false
  let cancel: (() => void) | undefined
  let tail: Promise<void> = Promise.resolve()

  const start = ports.clock.now()
  let lastStarted = localDateKey(start)

  const enqueue = (date: Date): void => {
    tail = tail.then(async () => {
      if (stopped) return
      try {
        await ports.run(date)
      } catch (error) {
        ports.logger.warn(`run failed: ${errorMessage(error)}`)
      }
    })
  }

  // Timers stop while the machine sleeps, so one long timer can fire hours
  // late; a short check timer notices the new day soon after the machine wakes.
  const scheduleCheck = (from: Date): void => {
    if (stopped) return
    const delay = Math.min(msUntilNextLocalDay(from), CHECK_INTERVAL_MS)
    cancel = ports.timer.set(delay, () => {
      cancel = undefined
      if (stopped) return
      const fired = ports.clock.now()
      const key = localDateKey(fired)
      if (key !== lastStarted) {
        lastStarted = key
        enqueue(fired)
      }
      scheduleCheck(fired)
    })
  }

  enqueue(start)
  scheduleCheck(start)

  return () => {
    stopped = true
    cancel?.()
    cancel = undefined
  }
}
