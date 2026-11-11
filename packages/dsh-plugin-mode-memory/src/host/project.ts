const TRAILING_SEPARATORS = /[\\/]+$/
const DRIVE_ROOT = /^[A-Za-z]:$/

/**
 * Normalize a Workspace or Session directory to one storage key.
 * @param path - directory path from the Harness.
 * @returns the path without trailing separators, or undefined for an empty path.
 */
export function normalizeProject(path: string): string | undefined {
  if (path === "") return undefined
  const stripped = path.replace(TRAILING_SEPARATORS, "")
  if (stripped === "" || DRIVE_ROOT.test(stripped)) return path
  return stripped
}
