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

/** One Session list row (`@deepseek-ai/dsh-api-session-controller`). */
export interface SessionSummary {
  readonly cwd?: string
  /** True until the Session's first turn. */
  readonly blank: boolean
}

export interface SessionListState {
  readonly byId: Readonly<Record<string, SessionSummary | undefined>>
}

export interface SessionsService {
  readonly list: Observable<SessionListState>
  /** Create a Session in a directory; the Host creates the directory when it is missing. */
  create(options: { cwd: string }): Promise<string>
}

export interface UiWorkspaceService {
  openSession(sessionId: string): void
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

/** A client-side slash command (`@deepseek-ai/dsh-client-ui-commands`). */
export interface CommandContribution {
  readonly name: string
  label?(): string
  description?(): string
  readonly icon?: ComponentType<{ size?: number; className?: string }>
  available(session: { sessionId: string }): boolean
  readonly ui: { readonly kind: "action"; run(session: { sessionId: string }): void }
}

export interface CommandUiService {
  register(contribution: CommandContribution): () => void
}

/** Values of the plugin's settings entry. */
export interface ScratchpadConfig {
  root?: string
  registerRoot?: boolean
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  /** Run `callback` while optional services are available. */
  inject(deps: string[], callback: (ctx: ClientContext) => void): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  sessions: SessionsService
  workspaces: WorkspacesService
  uiWorkspace: UiWorkspaceService
  remote: RemoteService
  commandUi?: CommandUiService
}
