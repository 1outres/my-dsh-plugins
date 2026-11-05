/**
 * Path and naming rules shared by both halves. Pure string work, no Node or
 * browser APIs: the browser half needs the same answers as the Host half.
 */

/** Default scratch root. `~` is the Host user's home directory. */
export const DEFAULT_ROOT = "~/.dsh/scratchpad"

/** Directory under the root that holds archived scratches. */
export const ARCHIVE_DIR = ".archived"

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
 * @returns the absolute root, or undefined when it cannot be resolved yet.
 */
export function resolveRoot(configured: string | undefined, home: string | undefined) {
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

/** Split a path into its parent directory and final segment. */
export function splitPath(path: string): { parent: string; name: string } {
  const trimmed = trimTrailingSlashes(path)
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  if (at < 0) return { parent: "", name: trimmed }
  return {
    parent: at === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, at),
    name: trimmed.slice(at + 1),
  }
}

/** Whether a directory name can be a scratch: not empty and not hidden. */
export function isScratchName(name: string): boolean {
  return name !== "" && !name.startsWith(".") && !/[\\/]/.test(name)
}

/**
 * Name of the scratch a path points at.
 * @param path - a Session cwd or Workspace path.
 * @param roots - every spelling of the root (configured and canonical).
 * @returns the scratch name when `path` sits directly under one of the roots.
 */
export function scratchNameOf(
  path: string | undefined,
  roots: readonly string[],
): string | undefined {
  if (path === undefined) return undefined
  const { parent, name } = splitPath(path)
  if (!isScratchName(name)) return undefined
  return roots.some((root) => trimTrailingSlashes(root) === parent) ? name : undefined
}

/** Whether `path` is one of the root spellings. */
export function isRootPath(path: string | undefined, roots: readonly string[]): boolean {
  if (path === undefined) return false
  const value = trimTrailingSlashes(path)
  return roots.some((root) => trimTrailingSlashes(root) === value)
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** Scratch directory name for a moment, in local time: `YYYY-MM-DD-HHmmss`. */
export function scratchName(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("-")
}

/**
 * First free name: `base`, then `base-2`, `base-3`, ...
 * @param taken - whether a candidate is already used.
 */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken(candidate)) return candidate
  }
}
