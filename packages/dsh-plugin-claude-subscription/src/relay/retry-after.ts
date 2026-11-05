const SECONDS = /^\d+$/

/**
 * The wait an upstream asks for in a `retry-after` header: whole seconds or an HTTP date.
 * Null when the header is absent or unusable. DSH accepts only a delay above zero, so a wait
 * that is already over is null too.
 */
export function retryAfterMs(header: string | string[] | undefined, now: number): number | null {
  if (typeof header !== "string") return null
  const value = header.trim()
  const wait = SECONDS.test(value) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isSafeInteger(wait) && wait > 0 ? wait : null
}
