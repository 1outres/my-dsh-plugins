import type { CredentialRef } from "@deepseek-ai/dsh-credentials"

/** Exa search modes this plugin exposes. */
export type SearchType = "auto" | "lite" | "deep-lite" | "deep"

/** Which content Exa returns for every search result. */
export type SearchContents = "highlights" | "text"

/** A volatile settings field: one operation reads its value once with `get()`. */
export interface VolatileValue<T> {
  get(): T
}

/** The Host config shape after the schema parses it. */
export interface ExaConfig {
  readonly apiKeyEnv: VolatileValue<string>
  readonly baseURL: VolatileValue<string>
  readonly searchType: VolatileValue<SearchType>
  readonly searchContents: VolatileValue<SearchContents>
  readonly searchMaxCharacters: VolatileValue<number>
  readonly includeDomains: VolatileValue<readonly string[]>
  readonly excludeDomains: VolatileValue<readonly string[]>
  readonly fetchMaxCharacters: VolatileValue<number>
}

/** Everything one Exa operation needs, snapshotted from the live config. */
export interface ExaOptions {
  readonly apiKeyEnv: string
  readonly baseURL: string
  readonly searchType: SearchType
  readonly searchContents: SearchContents
  readonly searchMaxCharacters: number
  readonly includeDomains: readonly string[]
  readonly excludeDomains: readonly string[]
  readonly fetchMaxCharacters: number
}

/** Presence and writability facts about one credential, without its value. */
export interface CredentialDescription {
  readonly configured: boolean
  readonly writable: boolean
  readonly source?: string
}

/** The part of `ctx.credentials` this plugin uses. */
export interface CredentialPort {
  resolve(
    ref: CredentialRef,
  ): Promise<{ readonly value: string; readonly source: string } | undefined>
  describe(ref: CredentialRef): Promise<CredentialDescription>
}

/** The part of `ctx.logger` this plugin uses. */
export interface LoggerPort {
  warn(message: string): void
}

/** The HTTP call type used by the client and its tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>
