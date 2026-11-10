import type { ComponentType } from "react"
import type { SessionStatusLike, SessionStatusMap } from "../shared/types"

export type {
  DiffOptions,
  NoticeEvent,
  NoticeKind,
  NoticeSpec,
  NotifyConfig,
  PageState,
  PendingInteractionLike,
  SessionStatusLike,
  SessionStatusMap,
  StatusDiff,
} from "../shared/types"

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

export interface RemoteService {
  /** Mount one Host Remote contribution in this plugin's fiber. */
  $mount(contribution: unknown): Promise<() => Promise<void>>
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  /** Unguarded lookup, used for the namespace this plugin mounts itself. */
  get(name: string): unknown
  sessions: SessionsService
  uiSession: UiSessionService
  uiWorkspace: UiWorkspaceService
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  remote: RemoteService
}
