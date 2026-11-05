import type { ComponentType } from "react"

/** A provider/model pair. The pair, never a joined string, identifies a model: ids may contain `/`. */
export interface ModelRef {
  provider: string
  model: string
}

/** A complete model selection, as `session.selectModel` accepts it. */
export interface ModelSelection extends ModelRef {
  reasoningEffort?: string
}

export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelReasoning {
  efforts: readonly ModelReasoningEffort[]
  defaultEffort?: string
}

export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: ModelReasoning
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: readonly ModelCatalogModel[]
}

export interface ModelCatalogFailure {
  id: string
  name: string
  message: string
}

/**
 * The per-Session directory snapshot published by `ctx.modelDirectories`
 * (`@deepseek-ai/dsh-client-ui-model-selection`). The plugin depends on this
 * shape instead of the owning package.
 */
export interface ModelDirectoryState {
  /** Saved selection, retained even when its provider or model leaves the catalog. */
  current: ModelSelection | null
  /** Saved effort caption retained when the selected model is unavailable. */
  retainedEffort?: string
  /** Whether the current selection is in the catalog; null while unresolved. */
  routable: boolean | null
  groups: readonly ModelProviderGroup[]
  failures: readonly ModelCatalogFailure[]
  status: "idle" | "loading" | "ready" | "selecting" | "error"
  /** Selection submitted by the latest `select` until it settles. */
  pending: ModelSelection | null
  error: string | null
}

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface RemoteError {
  code: string
  message: string
}

export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: RemoteError }

export interface ModelDirectoryLike {
  readonly store: Observable<ModelDirectoryState>
  load(): Promise<unknown>
  select(selection: ModelSelection): Promise<RemoteResult<void>>
}

export interface ModelDirectoriesService {
  /** Resolve the Session's shared directory; throws for unknown Sessions. */
  directoryFor(sessionId: string): ModelDirectoryLike
}

export interface SessionsService {
  /** Defined for addressed subagent Sessions, which expose no model selection. */
  subagentAddress(sessionId: string): unknown
}

/** Values persisted in the plugin's settings entry. */
export interface ModelPickerConfig {
  /** Favorite models, shown first in the picker. */
  favorites: ModelRef[]
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

export interface ConfigFormsService {
  get<T>(namespace: string): ConfigForm<T>
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface SlotRegistration {
  name: string
  priority?: number
  locale?: string
  inject?: (sessionId: string) => object
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: SlotRegistration, component: ComponentType<any>): () => void
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  sessions: SessionsService
  modelDirectories: ModelDirectoriesService
}
