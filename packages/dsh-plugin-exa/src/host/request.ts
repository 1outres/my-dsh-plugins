import type { WebFetchRequest, WebSearchRequest } from "@deepseek-ai/dsh-web"
import type { ExaOptions, SearchType } from "../contract"

/** Result count Exa uses when the model request sets no bound. */
export const DEFAULT_SEARCH_RESULTS = 10
/** Largest result count the Exa search endpoint accepts. */
export const MAX_SEARCH_RESULTS = 100

/** Contents options of a search request. */
export type ExaSearchContents =
  | { readonly highlights: { readonly maxCharacters: number } }
  | { readonly text: { readonly maxCharacters: number } }

/** POST /search body. */
export interface ExaSearchBody {
  readonly query: string
  readonly type: SearchType
  readonly numResults: number
  readonly contents: ExaSearchContents
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
}

/** POST /contents body. */
export interface ExaContentsBody {
  readonly urls: readonly string[]
  readonly text: { readonly maxCharacters: number }
}

/**
 * Translate the model layer's result bound into Exa's `numResults`.
 * @param maxResults - the request bound, when the model layer set one.
 * @returns 10 by default, otherwise the bound clamped to 1..100.
 */
export function numResultsFor(maxResults: number | undefined): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) return DEFAULT_SEARCH_RESULTS
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(maxResults)))
}

/** Build the POST /search body for one request and one settings snapshot. */
export function buildSearchBody(request: WebSearchRequest, options: ExaOptions): ExaSearchBody {
  return {
    query: request.query,
    type: options.searchType,
    numResults: numResultsFor(request.maxResults),
    contents:
      options.searchContents === "text"
        ? { text: { maxCharacters: options.searchMaxCharacters } }
        : { highlights: { maxCharacters: options.searchMaxCharacters } },
    ...(options.includeDomains.length > 0 ? { includeDomains: [...options.includeDomains] } : {}),
    ...(options.excludeDomains.length > 0 ? { excludeDomains: [...options.excludeDomains] } : {}),
  }
}

/**
 * Build the POST /contents body. One character more than the limit is asked
 * for, so a longer answer proves that the page was cut.
 */
export function buildContentsBody(request: WebFetchRequest, options: ExaOptions): ExaContentsBody {
  return {
    urls: [request.url],
    text: { maxCharacters: options.fetchMaxCharacters + 1 },
  }
}
