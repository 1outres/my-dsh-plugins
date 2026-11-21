import type { ComponentType } from "react"

/**
 * The slices of the Harness Client contracts this plugin uses. The plugin
 * depends on these shapes instead of importing the owning packages.
 */

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One registered Workspace (`@deepseek-ai/dsh-api-workspace-controller`). */
export interface WorkspaceView {
  readonly workspaceId: string
  /** Canonical Host directory path. */
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

export interface WorkspaceSnapshot {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly string[]
}

export interface WorkspacesService {
  readonly list: Observable<WorkspaceSnapshot>
}

export interface UiWorkspaceService {
  /** Open the Workspace's blank Session, creating one when it has none. */
  openWorkspace(workspaceId: string): Promise<void>
}

export interface RemoteService {
  /** Fixed Host facts; `home` is undefined until the first connection is ready. */
  readonly $host: { readonly home?: string }
}

export interface ConfigFormSnapshot<T> {
  status: "loading" | "ready" | "unavailable"
  value: T | undefined
}

export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
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
  id?: string
  order?: number
  locale?: string
  inject?: (sessionId: string) => object
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: SlotRegistration, component: ComponentType<any>): () => void
}

/** Values of the plugin's settings entry. */
export interface DailyWorkspaceConfig {
  root?: string
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  workspaces: WorkspacesService
  uiWorkspace: UiWorkspaceService
  remote: RemoteService
}
