/**
 * Date rules of the daily folders. Pure functions: no Node or Harness APIs in
 * the calculations, so the same answers hold in tests.
 */

import type { DailyPaths } from "../contract"
import { joinPath } from "../shared/paths"

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * Folders for one local day: `<root>/YYYY`, `<root>/YYYY/MM`, and
 * `<root>/YYYY/MM/DD`.
 * @param root - Absolute root directory.
 * @param date - Moment whose local date is used.
 */
export function dailyPaths(root: string, date: Date): DailyPaths {
  const year = joinPath(root, String(date.getFullYear()))
  const month = joinPath(year, pad(date.getMonth() + 1))
  const day = joinPath(month, pad(date.getDate()))
  return { year, month, day }
}

/** Local date of a moment as `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Milliseconds from `date` to the start of the next local day. The local Date
 * constructor adds the day, so a daylight saving change keeps local midnight.
 * @param date - Moment to measure from.
 */
export function msUntilNextLocalDay(date: Date): number {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return next.getTime() - date.getTime()
}
