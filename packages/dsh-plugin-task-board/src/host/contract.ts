import type {
  Author,
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

export interface Clock {
  now(): number
}

export interface IdSource {
  next(): string
}

export interface BoardTable {
  get(key: string): Board | undefined
  put(key: string, board: Board): Promise<void>
}

export interface CardTable {
  get(key: string): Card | undefined
  entries(): IterableIterator<[string, Card]>
  put(key: string, card: Card): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface BoardStore {
  board(project: ProjectPath): Board | undefined
  cards(project: ProjectPath): readonly Card[]
  card(project: ProjectPath, number: CardNumber): Card | undefined
  saveBoard(board: Board): Promise<void>
  saveCard(card: Card): Promise<void>
  deleteCard(project: ProjectPath, number: CardNumber): Promise<void>
}

export interface WorkspaceEntry {
  readonly id: string
  readonly path: string
  readonly title: string
}

export interface WorkspaceDirectory {
  list(): readonly WorkspaceEntry[]
}

export type PathKind = "file" | "directory" | "missing"

export interface FileSystemPort {
  realpath(path: string): Promise<string>
  kind(path: string): Promise<PathKind>
  readText(path: string): Promise<string>
}

export interface ProjectResolver {
  projects(): readonly ProjectSummary[]
  project(path: ProjectPath): ProjectSummary | undefined
  resolveDirectory(directory: string): Promise<TaskBoardOutcome<ProjectSummary>>
}

export interface SessionDirectoryPort {
  directoryOf(sessionId: SessionId): Promise<string | undefined>
  rootSessionOf(sessionId: SessionId): SessionId
}

export type BoardListener = (snapshot: BoardSnapshot) => void

export interface TaskBoardService {
  projects(): readonly ProjectSummary[]
  projectOfDirectory(directory: string): Promise<TaskBoardOutcome<ProjectSummary>>
  snapshot(project: ProjectPath): Promise<TaskBoardOutcome<BoardSnapshot>>
  watch(project: ProjectPath, listener: BoardListener): () => void
  card(project: ProjectPath, number: CardNumber): Promise<TaskBoardOutcome<Card>>
  cardsOfSession(
    project: ProjectPath,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<readonly Card[]>>
  createCard(
    project: ProjectPath,
    input: CreateCardInput,
    author: Author,
  ): Promise<TaskBoardOutcome<Card>>
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
    author: Author,
  ): Promise<TaskBoardOutcome<Comment>>
  deleteComment(
    project: ProjectPath,
    number: CardNumber,
    commentId: CommentId,
  ): Promise<TaskBoardOutcome<null>>
  linkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<Card>>
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
