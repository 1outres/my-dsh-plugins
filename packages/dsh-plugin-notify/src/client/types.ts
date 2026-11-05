import type { ComponentType } from "react"

/** Values persisted in the plugin's settings entry. */
export interface NotifyConfig {
  /** Master switch. Off shows no notification at all. */
  enabled: boolean
  /** Skip notifications while this page is visible and focused. */
  onlyWhenUnfocused: boolean
  /** Notify when a tool call waits for approval. */
  approval: boolean
  /** Notify when the agent asks a question or asks for a plan review. */
  question: boolean
  /** Notify when a turn stops running. */
  completion: boolean
  /** Add the request reason or question text to the body. */
  showDetail: boolean
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

/**
 * The parts of a pending interaction the browser half reads. The shipped
 * plugins publish concrete classes (`PendingApproval`, `PendingQuestion`); only
 * these fields matter here, so the plugin depends on the shape instead of the
 * owning packages.
 */
export interface PendingInteractionLike {
  /** Request identity; a replacement request publishes a new key. */
  readonly key: string
  /** Presentation discriminator: approval, question, or plan-review. */
  readonly kind: string
  readonly sessionId?: string
  readonly toolName?: string
  readonly reason?: string
  readonly displayReason?: Readonly<Record<string, string>>
  readonly questions?: readonly { readonly question?: string; readonly header?: string }[]
}

/** One Session's UI status as published by `uiSession.sessionStatus`. */
export interface SessionStatusLike {
  readonly running?: boolean
  readonly pendingInteraction?: PendingInteractionLike
  readonly completionUnread: boolean
}

export type SessionStatusMap = ReadonlyMap<string, SessionStatusLike>

export interface SessionRowLike {
  title?: string
  displayTitle?: string
  origin?: string
}

export interface SessionListSnapshot {
  ids: readonly string[]
  byId: Readonly<Record<string, SessionRowLike>>
}

export interface SessionsService {
  list: { getSnapshot(): SessionListSnapshot }
}

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface UiSessionService {
  sessionStatus: Observable<SessionStatusMap>
}

export interface UiWorkspaceService {
  /** Select a Session and show its Conversation. */
  openSession(target: string): void
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
  sessions: SessionsService
  uiSession: UiSessionService
  uiWorkspace: UiWorkspaceService
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
}
