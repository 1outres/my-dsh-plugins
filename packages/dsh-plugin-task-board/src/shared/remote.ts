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
} from "./model"

export const TASK_BOARD_SERVICE = "taskBoard"

export const TASK_BOARD_PACKAGE = "@1outres/dsh-plugin-task-board"

export const TASK_BOARD_COMMAND = "task"

export const TASK_BOARD_TOOL = "task_board"

export interface SessionBoard {
  readonly project: ProjectSummary
  readonly snapshot: BoardSnapshot
}

export interface TaskBoardRemoteApi {
  projects(): Promise<readonly ProjectSummary[]>
  projectOfSession(sessionId: SessionId): Promise<TaskBoardOutcome<ProjectSummary>>
  boardOfSession(sessionId: SessionId): Promise<TaskBoardOutcome<SessionBoard>>
  watch(project: ProjectPath, signal?: AbortSignal): AsyncIterable<TaskBoardOutcome<BoardSnapshot>>
  createCard(project: ProjectPath, input: CreateCardInput): Promise<TaskBoardOutcome<Card>>
  updateCard(
    project: ProjectPath,
    number: CardNumber,
    input: UpdateCardInput,
  ): Promise<TaskBoardOutcome<Card>>
  moveCard(
    project: ProjectPath,
    number: CardNumber,
    input: MoveCardInput,
  ): Promise<TaskBoardOutcome<Card>>
  deleteCard(project: ProjectPath, number: CardNumber): Promise<TaskBoardOutcome<null>>
  addComment(
    project: ProjectPath,
    number: CardNumber,
    body: string,
  ): Promise<TaskBoardOutcome<Comment>>
  deleteComment(
    project: ProjectPath,
    number: CardNumber,
    commentId: CommentId,
  ): Promise<TaskBoardOutcome<null>>
  unlinkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<Card>>
  addColumn(project: ProjectPath, title: string): Promise<TaskBoardOutcome<Column>>
  renameColumn(
    project: ProjectPath,
    columnId: ColumnId,
    title: string,
  ): Promise<TaskBoardOutcome<Column>>
  moveColumn(
    project: ProjectPath,
    columnId: ColumnId,
    index: number,
  ): Promise<TaskBoardOutcome<Board>>
  deleteColumn(project: ProjectPath, columnId: ColumnId): Promise<TaskBoardOutcome<null>>
}

export type TaskBoardRemoteMethod = keyof TaskBoardRemoteApi
