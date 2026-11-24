import type { Author } from "../shared/model"
import type { TaskBoardResult, Translate } from "./types"

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

export interface AuthorParts {
  readonly name: string
  readonly id: string | undefined
}

export function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim()
}

export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

export function authorParts(author: Author, t: Translate): AuthorParts {
  if (author.kind === "user") return { name: t("authorYou"), id: undefined }
  return { name: t("authorAgent"), id: shortSessionId(author.sessionId) }
}

export function failureText(
  result: TaskBoardResult<unknown>,
  t: Translate,
  key: string,
): string | undefined {
  if (result.status === "ok") return undefined
  return t(key, { message: result.error.message })
}

export function relativeTime(timestamp: number, now: number, locale: string): string {
  const elapsed = now - timestamp
  const words = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (Math.abs(elapsed) < MINUTE_MS) return words.format(0, "second")
  if (elapsed < 0) return shortDate(timestamp, now, locale)
  if (elapsed < HOUR_MS) return words.format(-Math.floor(elapsed / MINUTE_MS), "minute")
  if (elapsed < DAY_MS) return words.format(-Math.floor(elapsed / HOUR_MS), "hour")
  if (elapsed < WEEK_MS) return words.format(-Math.floor(elapsed / DAY_MS), "day")
  return shortDate(timestamp, now, locale)
}

export function fullTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    timestamp,
  )
}

function shortDate(timestamp: number, now: number, locale: string): string {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear()
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" }
  return new Intl.DateTimeFormat(locale, options).format(timestamp)
}
