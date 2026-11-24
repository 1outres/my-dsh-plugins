import type { ComponentType } from "react"
import type {
  Board,
  BoardSnapshot,
  Card,
  CardNumber,
  Column,
  ColumnId,
  Comment,
  CommentId,
  CreateCardInput,
  MoveCardInput,
  ProjectPath,
  ProjectSummary,
  SessionId,
  TaskBoardOutcome,
  UpdateCardInput,
} from "../shared/model"
import type { SessionBoard } from "../shared/remote"

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface RemoteFailure {
  readonly code: string
  readonly message: string
}

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

export interface TaskBoardFailure {
  readonly code: string
  readonly message: string
}

export type TaskBoardResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "error"; readonly error: TaskBoardFailure }

export interface TaskBoardStreamHandle extends AsyncIterable<TaskBoardOutcome<BoardSnapshot>> {
  dispose(): void
}

export interface TaskBoardRemote {
  projects(): Promise<RemoteResult<readonly ProjectSummary[]>>
  projectOfSession(sessionId: SessionId): Promise<RemoteResult<TaskBoardOutcome<ProjectSummary>>>
  boardOfSession(sessionId: SessionId): Promise<RemoteResult<TaskBoardOutcome<SessionBoard>>>
  watch(project: ProjectPath, signal?: AbortSignal): TaskBoardStreamHandle
  createCard(
    project: ProjectPath,
    input: CreateCardInput,
  ): Promise<RemoteResult<TaskBoardOutcome<Card>>>
  updateCard(
    project: ProjectPath,
    number: CardNumber,
    input: UpdateCardInput,
  ): Promise<RemoteResult<TaskBoardOutcome<Card>>>
  moveCard(
    project: ProjectPath,
    number: CardNumber,
    input: MoveCardInput,
  ): Promise<RemoteResult<TaskBoardOutcome<Card>>>
  deleteCard(
    project: ProjectPath,
    number: CardNumber,
  ): Promise<RemoteResult<TaskBoardOutcome<null>>>
  addComment(
    project: ProjectPath,
    number: CardNumber,
    body: string,
  ): Promise<RemoteResult<TaskBoardOutcome<Comment>>>
  deleteComment(
    project: ProjectPath,
    number: CardNumber,
    commentId: CommentId,
  ): Promise<RemoteResult<TaskBoardOutcome<null>>>
  unlinkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<RemoteResult<TaskBoardOutcome<Card>>>
  addColumn(project: ProjectPath, title: string): Promise<RemoteResult<TaskBoardOutcome<Column>>>
  renameColumn(
    project: ProjectPath,
    columnId: ColumnId,
    title: string,
  ): Promise<RemoteResult<TaskBoardOutcome<Column>>>
  moveColumn(
    project: ProjectPath,
    columnId: ColumnId,
    index: number,
  ): Promise<RemoteResult<TaskBoardOutcome<Board>>>
  deleteColumn(
    project: ProjectPath,
    columnId: ColumnId,
  ): Promise<RemoteResult<TaskBoardOutcome<null>>>
}

export interface CommandExecution {
  readonly result:
    | { readonly kind: "success"; readonly text?: string }
    | { readonly kind: "error"; readonly text: string }
}

export interface CommandsRemote {
  execute(
    sessionId: SessionId,
    line: string,
    submittedAttachments: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<RemoteResult<CommandExecution | undefined>>
}

export interface RemoteService {
  $mount(contribution: unknown): Promise<() => Promise<void>>
  readonly commands: CommandsRemote
}

export interface LayoutService {
  selectPanel(panelId: string | null): void
}

export interface SlotRegistration {
  readonly name: string
  readonly key?: string
  readonly id?: string
  readonly order?: number
  readonly label?: string | (() => string)
  readonly locale?: string
  readonly inject?: (() => object) | ((sessionId: string) => object)
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: SlotRegistration, component: ComponentType<any>): () => void
}

export interface LocaleSnapshot {
  readonly active: string
}

export interface LocaleSource {
  getSnapshot(): LocaleSnapshot
  subscribe(listener: () => void): () => void
}

export interface LocaleService extends LocaleSource {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  get(name: string): unknown
  inject(deps: string[], callback: (scope: ClientContext) => void): void
  slots: SlotsService
  locale: LocaleService
  remote: RemoteService
  layout: LayoutService
}

export interface SelectOptionGroup {
  readonly name: string
  readonly label: string
}

export interface SelectOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly group?: SelectOptionGroup
  readonly active?: boolean
}

export interface PopupSearchLabels {
  readonly placeholder: string
  readonly empty: string
  readonly noResults: string
}

export interface PopupSelectSpec {
  readonly kind: "popupSelect"
  readonly searchMode?: "substring" | "fuzzy-label"
  searchLabels?(): PopupSearchLabels
  options(session: SessionContext, signal: AbortSignal): Promise<readonly SelectOption[]>
  onSelect(option: SelectOption, session: SessionContext): void | Promise<void>
}

export interface CommandDecoration {
  readonly name: string
  available(session: SessionContext): boolean
  readonly ui: PopupSelectSpec
}

export interface CommandUiContract {
  decorate(decoration: CommandDecoration): () => void
}

export interface SessionContext {
  readonly sessionId: SessionId
}
