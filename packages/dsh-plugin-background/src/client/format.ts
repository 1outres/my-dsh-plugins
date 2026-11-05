/** Clamp a possibly hostile number into a range. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Whether a setting value points at an absolute URL. */
export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** Whether a setting value is an absolute Host path (POSIX or Windows). */
export function isAbsolutePath(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)
}

/**
 * Resolve the configured image into a URL the browser can paint.
 *
 * Remote URLs pass through. Absolute paths are handed to the authenticated
 * `/api/file` route, which serves Host files to the browser session. Anything
 * else is rejected so a relative path never turns into a confusing 404.
 */
export function resolveImageSource(value: string, base: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (isRemoteUrl(trimmed)) return trimmed
  if (!isAbsolutePath(trimmed)) return undefined
  try {
    return new URL(`api/file?path=${encodeURIComponent(trimmed)}`, base).href
  } catch {
    return undefined
  }
}

/** Build a CSS `url()` value without letting quotes break out of it. */
export function imageCssValue(url: string): string {
  return `url(${JSON.stringify(url)})`
}

/** Make a color partially transparent while keeping its theme-owned hue. */
export function alphaColor(color: string, percent: number): string {
  const clamped = clamp(percent, 0, 100)
  if (clamped >= 100) return color
  return `color-mix(in srgb, ${color} ${formatNumber(clamped)}%, transparent)`
}

/** The veil painted between the image and the interface. */
export function dimColor(percent: number): string {
  return `rgba(0, 0, 0, ${formatNumber(clamp(percent, 0, 100) / 100)})`
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}
