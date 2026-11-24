export type ProjectPath = string

export type SessionId = string

export type ColumnId = string

export type CommentId = string

export type CardNumber = number

export type ColumnPreset = "todo" | "in_progress" | "done"

export const DEFAULT_COLUMN_PRESETS: readonly ColumnPreset[] = ["todo", "in_progress", "done"]

export const COLUMN_PRESET_TITLES: Readonly<Record<ColumnPreset, string>> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
}

export type ColumnTitle =
  | { readonly kind: "preset"; readonly preset: ColumnPreset }
  | { readonly kind: "text"; readonly text: string }

export interface Column {
  readonly id: ColumnId
  readonly title: ColumnTitle
  readonly cardNumbers: readonly CardNumber[]
}

export interface Board {
  readonly project: ProjectPath
  readonly columns: readonly Column[]
  readonly nextCardNumber: CardNumber
  readonly createdAt: number
  readonly updatedAt: number
}

export type Author =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly sessionId: SessionId }

export interface Comment {
  readonly id: CommentId
  readonly author: Author
  readonly body: string
  readonly createdAt: number
}

export interface Card {
  readonly project: ProjectPath
  readonly number: CardNumber
  readonly title: string
  readonly description: string
  readonly comments: readonly Comment[]
  readonly sessionIds: readonly SessionId[]
  readonly createdBy: Author
  readonly createdAt: number
  readonly updatedAt: number
}

export interface BoardSnapshot {
  readonly board: Board
  readonly cards: readonly Card[]
}

export interface ProjectSummary {
  readonly path: ProjectPath
  readonly title: string
  readonly workspaceId: string
}

export type TaskBoardErrorCode =
  | "project_not_found"
  | "session_not_found"
  | "card_not_found"
  | "column_not_found"
  | "comment_not_found"
  | "column_not_empty"
  | "last_column"
  | "invalid_input"

export interface TaskBoardError {
  readonly code: TaskBoardErrorCode
  readonly message: string
}

export type TaskBoardOutcome<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "error"; readonly error: TaskBoardError }

export interface CreateCardInput {
  readonly title: string
  readonly description: string
  readonly columnId?: ColumnId
}

export interface UpdateCardInput {
  readonly title?: string
  readonly description?: string
}

export interface MoveCardInput {
  readonly columnId: ColumnId
  readonly index?: number
}
