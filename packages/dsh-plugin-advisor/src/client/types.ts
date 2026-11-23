import type { ComponentType } from "react"
import type { AdvisorSettingValues } from "../shared/settings"

export type AdvisorFormValues = AdvisorSettingValues

export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: ModelReasoning
}

export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

export interface ModelCatalog {
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly ModelCatalogFailure[]
}

export interface RemoteFailure {
  readonly code: string
  readonly message: string
}

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

export type SettingsPathOp =
  | { readonly op: "set"; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: "unset"; readonly path: readonly string[] }

export interface ConfigFormSnapshot<T> {
  readonly status: "loading" | "ready" | "unavailable"
  readonly value: T | undefined
  readonly revision: number | undefined
  readonly writable: boolean
}

export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<boolean>
}

export interface ConfigFormsService {
  get<T>(namespace: string): ConfigForm<T>
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

export interface SessionRemote {
  modelCatalog(): Promise<RemoteResult<ModelCatalog>>
}

export type HostModelEvent = "llm/adapters-updated" | "llm/models-updated"

export interface RemoteService {
  readonly session: SessionRemote
  $on(event: HostModelEvent, listener: () => void): () => void
}

export interface SlotRegistration {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly label?: string | (() => string)
  readonly locale?: string
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

export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  readonly slots: SlotsService
  readonly locale: LocaleService
  readonly configForms: ConfigFormsService
  readonly remote: RemoteService
}
