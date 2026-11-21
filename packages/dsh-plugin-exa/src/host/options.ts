import type { ExaConfig, ExaOptions } from "../contract"

/**
 * Read every volatile settings field once, so one operation never mixes two
 * settings changes.
 * @param config - live Host config.
 * @returns a detached snapshot for one operation.
 */
export function snapshotOptions(config: ExaConfig): ExaOptions {
  return {
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    searchType: config.searchType.get(),
    searchContents: config.searchContents.get(),
    searchMaxCharacters: config.searchMaxCharacters.get(),
    includeDomains: [...config.includeDomains.get()],
    excludeDomains: [...config.excludeDomains.get()],
    fetchMaxCharacters: config.fetchMaxCharacters.get(),
  }
}

/**
 * Join an Exa endpoint path onto the configured base URL without doubling a
 * slash when the base URL ends with one.
 * @param baseURL - the configured API base.
 * @param path - the endpoint path, with or without a leading slash.
 */
export function endpointURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/u, "")}/${path.replace(/^\/+/, "")}`
}
