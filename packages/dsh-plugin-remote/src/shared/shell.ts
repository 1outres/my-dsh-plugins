/** Quote one value for a POSIX shell word. */
export function shellQuote(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** True when a path cannot be passed to the remote shell at all. */
export function isUsablePath(value: string): boolean {
  return value.length > 0 && !value.includes("\u0000")
}
