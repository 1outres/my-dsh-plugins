import type { ComponentType } from "react"
import type { SearchContents, SearchType } from "../contract"

export type { SearchContents, SearchType }

/** Settings values the browser half reads from the `exa` namespace. */
export interface ExaConfig {
  apiKeyEnv: string
  baseURL: string
  searchType: SearchType
  searchContents: SearchContents
  searchMaxCharacters: number
  includeDomains: string[]
  excludeDomains: string[]
  fetchMaxCharacters: number
}

/** Provider selection fields the page reads from the `web` namespace. */
export interface WebConfig {
  searchProvider?: string
  fetchProvider?: string
}

export interface ConfigFormSnapshot<T> {
  status: "loading" | "ready" | "unavailable"
  value: T | undefined
  revision: number | undefined
  writable: boolean
}

export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

/** Presence and source facts of one credential, never its value. */
export interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

/** The error branch of a Remote call. */
export interface RemoteFailureLike {
  readonly code: string
  readonly message: string
}

/** What every generated Remote method resolves to. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailureLike }

/** The `remote.credentials` namespace this page uses. */
export interface CredentialsRemote {
  describe(refs: readonly string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult<void>>
  unset(ref: string): Promise<RemoteResult<void>>
}

export interface RemoteService {
  readonly credentials: CredentialsRemote
  $on(event: "credentials/reference-updated", listener: (ref: string) => void): () => void
}

export interface SlotRegistration {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  locale?: string
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  register(options: SlotRegistration, component: ComponentType): () => void
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface ConfigFormsService {
  get<T>(namespace: string): ConfigForm<T>
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  remote: RemoteService
}
