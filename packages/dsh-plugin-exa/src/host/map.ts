import type { WebFetchResult, WebSearchResult, WebSearchSource } from "@deepseek-ai/dsh-web"
import type { ExaOptions, SearchContents } from "../contract"
import { invalidResponseError, providerError } from "./errors"
import { isRecord, nonEmptyString } from "./json"

/** Characters of full text kept for a source's display snippet. */
export const SNIPPET_MAX_CHARACTERS = 300

/** The separator between joined highlights. */
const HIGHLIGHT_SEPARATOR = " … "

/** What one search response maps to, plus the warnings meant for the log. */
export interface MappedSearch {
  readonly result: WebSearchResult
  readonly warnings: readonly string[]
}

/** One fetch request's identity and content limit. */
export interface FetchTarget {
  readonly url: string
  readonly maxCharacters: number
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

/** Collapse each non-empty string in a wire array. */
function collapsedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const collapsed: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const text = collapseWhitespace(item)
    if (text.length > 0) collapsed.push(text)
  }
  return collapsed
}

/** The first characters of a text, cut at a word boundary and marked. */
function snippetOf(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARACTERS) return text
  const head = text.slice(0, SNIPPET_MAX_CHARACTERS)
  const boundary = head.lastIndexOf(" ")
  return `${boundary > 0 ? head.slice(0, boundary) : head}…`
}

/** Map one Exa result to a citeable source, or undefined without a URL. */
function sourceOf(item: unknown, contents: SearchContents): WebSearchSource | undefined {
  if (!isRecord(item)) return undefined
  const url = nonEmptyString(item.url)
  if (url === undefined) return undefined

  const source: {
    url: string
    title?: string
    snippet?: string
    summary?: string
    publishedAt?: string
  } = { url }

  const title = nonEmptyString(item.title)
  if (title !== undefined) source.title = title
  const publishedAt = nonEmptyString(item.publishedDate)
  if (publishedAt !== undefined) source.publishedAt = publishedAt

  if (contents === "highlights") {
    const highlights = collapsedStrings(item.highlights)
    if (highlights.length > 0) {
      source.snippet = highlights[0]
      source.summary = highlights.join(HIGHLIGHT_SEPARATOR)
    }
    return source
  }

  const text = typeof item.text === "string" ? collapseWhitespace(item.text) : ""
  if (text.length > 0) {
    source.summary = text
    source.snippet = snippetOf(text)
  }
  return source
}

/** Notice messages Exa asks the caller to show to the model. */
function noticeLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const lines: string[] = []
  for (const notice of value) {
    if (!isRecord(notice)) continue
    const message = nonEmptyString(notice.message)
    if (message !== undefined) lines.push(message)
  }
  return lines
}

/**
 * Synthesized answer text, followed by the notice block when Exa reported
 * notices. Empty when the response carries neither.
 */
function searchContent(payload: Record<string, unknown>): string | undefined {
  const output = payload.output
  const answer = isRecord(output) ? nonEmptyString(output.content) : undefined
  const notices = noticeLines(payload.notices)
  if (notices.length === 0) return answer
  const block = ["Notes from Exa:", ...notices.map((message) => `- ${message}`)].join("\n")
  return answer === undefined ? block : `${answer}\n\n${block}`
}

/**
 * Turn request warnings into log lines. Warnings are for the operator, not
 * for the model.
 */
export function searchWarnings(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.warnings)) return []
  const lines: string[] = []
  for (const warning of payload.warnings) {
    if (!isRecord(warning)) continue
    const message = nonEmptyString(warning.message)
    if (message === undefined) continue
    const code = nonEmptyString(warning.code)
    const path = nonEmptyString(warning.path)
    let prefix = "Exa warning"
    if (code !== undefined) prefix += ` ${code}`
    if (path !== undefined) prefix += ` at ${path}`
    lines.push(`${prefix}: ${message}`)
  }
  return lines
}

/**
 * Map a POST /search response into the web seam's result.
 * @param payload - untrusted JSON from Exa.
 * @param options - the content mode chosen for this search.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body is not a search response.
 */
export function mapSearchResponse(
  payload: unknown,
  options: Pick<ExaOptions, "searchContents">,
): MappedSearch {
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw invalidResponseError()

  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const item of payload.results) {
    const source = sourceOf(item, options.searchContents)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }

  const content = searchContent(payload)
  return {
    result: {
      sources,
      ...(content === undefined ? {} : { content }),
      truncated: false,
    },
    warnings: searchWarnings(payload),
  }
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

/** The status entry that belongs to the requested URL. */
function statusFor(
  statuses: readonly Record<string, unknown>[],
  url: string,
): Record<string, unknown> | undefined {
  return (
    statuses.find((status) => status.id === url) ??
    (statuses.length === 1 ? statuses[0] : undefined)
  )
}

/** The result entry that belongs to the requested URL. */
function resultFor(
  results: readonly Record<string, unknown>[],
  url: string,
): Record<string, unknown> | undefined {
  return (
    results.find((result) => result.url === url || result.id === url) ??
    (results.length === 1 ? results[0] : undefined)
  )
}

/**
 * A failed crawl with an HTTP status is a page result, not a provider
 * failure; without a status code Exa only reports a tag.
 */
function errorStatusResult(status: Record<string, unknown>, url: string): WebFetchResult {
  const error = isRecord(status.error) ? status.error : undefined
  const statusCode = error?.httpStatusCode
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) {
    return {
      url,
      statusCode,
      body: { kind: "text", content: "" },
      truncated: false,
    }
  }
  const tag = error === undefined ? undefined : nonEmptyString(error.tag)
  throw providerError(`Exa could not fetch ${url}${tag === undefined ? "" : ` (${tag})`}`)
}

/**
 * Map a POST /contents response into the web seam's fetch result.
 * @param payload - untrusted JSON from Exa.
 * @param target - the requested URL and the configured content limit.
 * @throws WebError `WEB_PROVIDER_ERROR` when no page can be reported.
 */
export function mapContentsResponse(payload: unknown, target: FetchTarget): WebFetchResult {
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw invalidResponseError()

  const status = statusFor(recordsOf(payload.statuses), target.url)
  if (status !== undefined && status.status === "error") {
    return errorStatusResult(status, target.url)
  }

  const chosen = resultFor(recordsOf(payload.results), target.url)
  if (chosen === undefined) throw providerError(`Exa returned no content for ${target.url}`)

  const url = nonEmptyString(chosen.url) ?? target.url
  const text = typeof chosen.text === "string" ? chosen.text : ""
  const truncated = text.length > target.maxCharacters
  return {
    url,
    statusCode: 200,
    body: {
      kind: "text",
      content: truncated ? text.slice(0, target.maxCharacters) : text,
    },
    truncated,
  }
}
