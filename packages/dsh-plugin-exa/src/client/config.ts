import type { ExaConfig, SearchContents, SearchType } from "./types"

/**
 * The profile entry id in the bundle patch. It is also the settings namespace
 * the browser half reads, so the two halves must agree on it.
 */
export const CONFIG_NAMESPACE = "exa"

/** The web seam's namespace, which names the selected providers. */
export const WEB_NAMESPACE = "web"

/** Provider id registered by the Host half. */
export const PROVIDER_ID = "exa"

/** Credential reference used until the settings store one of its own. */
export const DEFAULT_API_KEY_ENV = "EXA_API_KEY"

/** Shown when a field was never written (schema defaults live in the host half). */
export const DEFAULT_CONFIG: ExaConfig = {
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  baseURL: "https://api.exa.ai",
  searchType: "auto",
  searchContents: "highlights",
  searchMaxCharacters: 1000,
  includeDomains: [],
  excludeDomains: [],
  fetchMaxCharacters: 100000,
}

/** Search modes offered by the page, in display order. */
export const SEARCH_TYPES: readonly SearchType[] = ["auto", "lite", "deep-lite", "deep"]

/** Content choices offered by the page, in display order. */
export const SEARCH_CONTENTS: readonly SearchContents[] = ["highlights", "text"]

function isSearchType(value: unknown): value is SearchType {
  return SEARCH_TYPES.some((choice) => choice === value)
}

function isSearchContents(value: unknown): value is SearchContents {
  return SEARCH_CONTENTS.some((choice) => choice === value)
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const domains: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const domain = item.trim()
    if (domain.length > 0) domains.push(domain)
  }
  return domains
}

/** Coerce one Host section into the shape the browser half expects. */
export function normalizeConfig(value: Partial<ExaConfig> | undefined): ExaConfig {
  return {
    apiKeyEnv: readString(value?.apiKeyEnv, DEFAULT_CONFIG.apiKeyEnv),
    baseURL: readString(value?.baseURL, DEFAULT_CONFIG.baseURL),
    searchType: isSearchType(value?.searchType) ? value.searchType : DEFAULT_CONFIG.searchType,
    searchContents: isSearchContents(value?.searchContents)
      ? value.searchContents
      : DEFAULT_CONFIG.searchContents,
    searchMaxCharacters: readNumber(value?.searchMaxCharacters, DEFAULT_CONFIG.searchMaxCharacters),
    includeDomains: readDomains(value?.includeDomains),
    excludeDomains: readDomains(value?.excludeDomains),
    fetchMaxCharacters: readNumber(value?.fetchMaxCharacters, DEFAULT_CONFIG.fetchMaxCharacters),
  }
}

/** Split a textarea into one domain per line, dropping blank lines. */
export function parseDomains(text: string): string[] {
  const domains: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const domain = line.trim()
    if (domain.length > 0) domains.push(domain)
  }
  return domains
}

/** Show a domain list as one entry per line. */
export function formatDomains(domains: readonly string[]): string {
  return domains.join("\n")
}
