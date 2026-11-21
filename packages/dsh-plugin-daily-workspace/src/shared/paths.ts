/**
 * Path rules shared by both halves. Pure string work, no Node or browser APIs:
 * the browser half needs the same answers as the Host half.
 */

/** Default root. `~` is the Host user's home directory. */
export const DEFAULT_ROOT = "~/Documents"

/** The year, month, and day folders of one day, as path segments. */
export interface DayFolder {
  readonly year: string
  readonly month: string
  readonly day: string
}

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

function isMonth(value: string): boolean {
  return /^(0[1-9]|1[0-2])$/.test(value)
}

function isDay(value: string): boolean {
  return /^(0[1-9]|[12][0-9]|3[01])$/.test(value)
}

/**
 * Read the day a Workspace path points at.
 * @param path - a Workspace path.
 * @param root - absolute root that holds the year folders.
 * @returns the date segments when `path` is exactly `<root>/YYYY/MM/DD`.
 */
export function dayFolderOf(path: string | undefined, root: string): DayFolder | undefined {
  if (path === undefined) return undefined
  const base = trimTrailingSlashes(root)
  const sep = separatorOf(base)
  const value = trimTrailingSlashes(path)
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  if (!value.startsWith(prefix)) return undefined
  const segments = value.slice(prefix.length).split(sep)
  if (segments.length !== 3) return undefined
  const [year, month, day] = segments
  if (year === undefined || month === undefined || day === undefined) return undefined
  if (!/^\d{4}$/.test(year) || !isMonth(month) || !isDay(day)) return undefined
  return { year, month, day }
}
