/**
 * Path and date rules of the daily folders. Pure functions: no Node or
 * Harness APIs in the calculations, so the same answers hold in tests.
 */

import type { DailyPaths } from "../contract"

/** Default root. `~` is the Host user's home directory. */
export const DEFAULT_ROOT = "~/Documents"

function trimTrailingSlashes(path: string): string {
  let end = path.length
  while (end > 1 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--
  return path.slice(0, end)
}

/**
 * Expand a leading `~` against `home` and drop trailing separators. Other
 * paths are returned trimmed but otherwise unchanged.
 * @returns the expanded path, or undefined when `~` is used and `home` is unknown.
 */
export function expandHome(path: string, home: string | undefined): string | undefined {
  const value = path.trim()
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    if (home === undefined || home === "") return undefined
    return trimTrailingSlashes(`${trimTrailingSlashes(home)}${value.slice(1)}`)
  }
  return trimTrailingSlashes(value)
}

/** Whether `path` is absolute on POSIX or Windows. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
}

/**
 * Resolve the configured root to an absolute path.
 * @returns the absolute root, or undefined when it cannot be resolved.
 */
export function resolveRoot(
  configured: string | undefined,
  home: string | undefined,
): string | undefined {
  const raw = configured === undefined || configured.trim() === "" ? DEFAULT_ROOT : configured
  const expanded = expandHome(raw, home)
  if (expanded === undefined || !isAbsolutePath(expanded)) return undefined
  return expanded
}

/** Separator to use under `root`: a Windows root keeps backslashes. */
function separatorOf(root: string): string {
  return /^[A-Za-z]:\\/.test(root) || root.startsWith("\\\\") ? "\\" : "/"
}

/** Join one child name onto a directory. */
export function joinPath(dir: string, name: string): string {
  const base = trimTrailingSlashes(dir)
  const sep = separatorOf(base)
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`
}

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
