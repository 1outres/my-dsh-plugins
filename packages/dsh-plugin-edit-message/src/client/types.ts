import type { ComponentType } from "react"

/**
 * The slices of the Harness Client contracts this plugin uses. The plugin
 * depends on these shapes instead of importing the owning packages.
 */

export interface RemoteError {
  code: string
  message: string
}

export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: RemoteError }

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One durable content block of a message, narrowed field by field where used. */
export interface ContentBlock {
  type: string
  text?: unknown
  attachment?: unknown
}

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: string
  name?: string
}

/** One durable Session event; only the fields the boundary walk reads. */
export interface SessionEvent {
  type: string
  seq: number
  surfaceOp?: unknown
}

export type SessionEventEntry =
  | { type: "event"; event: SessionEvent }
  | { type: "transient"; event: unknown }

export interface SessionEventWindow {
  entries: readonly SessionEventEntry[]
  hasMore: boolean
}

/** Browser-submitted prompt content, as `session.prompt` accepts it. */
export type PromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string }

export interface SessionSnapshot {
  running: boolean
  subagent: unknown
}

export interface SessionFace extends Observable<SessionSnapshot> {
  readonly sessionId: string
  readonly projections: { faceOf(key: string): Observable<unknown> }
  prompt(content: PromptContentPart[], mode: "queue" | "steer"): Promise<RemoteResult<unknown>>
  readAttachment(
    attachmentId: string,
  ): Promise<RemoteResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>>
  updateQueue(itemId: string, action: { kind: "remove" }): Promise<RemoteResult<unknown>>
  rename(title: string): Promise<RemoteResult<unknown>>
  loadThrough(seq: number): Promise<void>
}

export interface SessionBinding {
  readonly sessionId: string
  readonly session: SessionFace
  readonly eventSource: Observable<SessionEventWindow>
}

export interface SessionReference {
  readonly ready: Promise<SessionBinding>
  release(): void
}

export interface SessionSummary {
  title?: string
}

export interface SessionListState {
  byId: Readonly<Record<string, SessionSummary | undefined>>
  projectionsBySession?: Readonly<
    Record<string, { values?: Readonly<Record<string, unknown>> } | undefined>
  >
}

export interface SessionsService {
  readonly list: Observable<SessionListState>
  binding(id: string): SessionBinding | undefined
  retain(id: string, options: { source: string }): SessionReference
  fork(options: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  refreshProjections(id: string): Promise<void>
}

export interface UiWorkspaceService {
  openSession(sessionId: string): void
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
}

export interface WorkspaceView {
  workspaceId: string
  sessionIds: readonly string[]
}

export interface WorkspacesService {
  readonly list: Observable<{ items: readonly WorkspaceView[] }>
  insertSessionBefore(
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ): Promise<unknown>
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface SlotRegistration {
  name: string
  key?: string
  priority?: number
  locale?: string
}

/** One stored slot entry, as `ctx.slots.entries()` returns it. */
export interface StoredSlotEntry {
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  component: ComponentType<any>
  options: { key?: string; id?: string; priority?: number }
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: SlotRegistration, component: ComponentType<any>): () => void
  /** Present on the shipped registry; absent faces leave the plugin inactive. */
  entries?(key: string): readonly StoredSlotEntry[]
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  slots: SlotsService
  locale: LocaleService
  sessions: SessionsService
  uiWorkspace: UiWorkspaceService
  workspaces?: WorkspacesService
}
