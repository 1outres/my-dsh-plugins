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
import {
  boardWithCardAt,
  boardWithColumn,
  boardWithNextCardNumber,
  boardWithoutCard,
  boardWithoutColumn,
  createDefaultBoard,
} from "./board"
import {
  cardWithComment,
  cardWithFields,
  cardWithoutComment,
  cardWithoutSession,
  cardWithSession,
} from "./card"
import { columnOf, columnTitleText } from "./columns"
import type {
  BoardListener,
  BoardStore,
  Clock,
  IdSource,
  ProjectResolver,
  TaskBoardService,
} from "./contract"
import { fail, TaskBoardOperationError } from "./errors"
import { ProjectQueue } from "./queue"
import { cardNumberOf, indexWithin, requiredText } from "./validation"

export interface TaskBoardServiceDeps {
  readonly store: BoardStore
  readonly resolver: ProjectResolver
  readonly clock: Clock
  readonly ids: IdSource
}

class TaskBoard implements TaskBoardService {
  readonly #store: BoardStore
  readonly #resolver: ProjectResolver
  readonly #clock: Clock
  readonly #ids: IdSource
  readonly #queue = new ProjectQueue()
  readonly #listeners = new Map<ProjectPath, Set<BoardListener>>()

  constructor(deps: TaskBoardServiceDeps) {
    this.#store = deps.store
    this.#resolver = deps.resolver
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  projects(): readonly ProjectSummary[] {
    return this.#resolver.projects()
  }

  projectOfDirectory(directory: string): Promise<TaskBoardOutcome<ProjectSummary>> {
    return this.#resolver.resolveDirectory(directory)
  }

  snapshot(project: ProjectPath): Promise<TaskBoardOutcome<BoardSnapshot>> {
    return this.#run(project, async (path) => {
      await this.#boardOf(path)
      return this.#snapshotOf(path)
    })
  }

  watch(project: ProjectPath, listener: BoardListener): () => void {
    const key = this.#resolver.project(project)?.path ?? project
    const listeners = this.#listeners.get(key) ?? new Set<BoardListener>()
    listeners.add(listener)
    this.#listeners.set(key, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(key)
    }
  }

  card(project: ProjectPath, number: CardNumber): Promise<TaskBoardOutcome<Card>> {
    return this.#run(project, async (path) => this.#cardOf(path, cardNumberOf(number)))
  }

  cardsOfSession(
    project: ProjectPath,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<readonly Card[]>> {
    return this.#run(project, async (path) => {
      const id = this.#sessionIdOf(sessionId)
      return this.#store.cards(path).filter((card) => card.sessionIds.includes(id))
    })
  }

  createCard(
    project: ProjectPath,
    input: CreateCardInput,
    author: Author,
  ): Promise<TaskBoardOutcome<Card>> {
    return this.#mutate(project, async (path, board) => {
      const title = requiredText(input.title, "A card title must not be empty.")
      const description = input.description.trim()
      const column =
        input.columnId === undefined ? board.columns[0] : columnOf(board, input.columnId)
      if (column === undefined) {
        fail("column_not_found", `Column "${input.columnId}" does not exist in this board.`)
      }
      const now = this.#clock.now()
      const card: Card = {
        project: path,
        number: board.nextCardNumber,
        title,
        description,
        comments: [],
        sessionIds: [],
        createdBy: author,
        createdAt: now,
        updatedAt: now,
      }
      const placed = boardWithCardAt(board, card.number, column.id, undefined, now)
      await this.#store.saveCard(card)
      await this.#store.saveBoard(boardWithNextCardNumber(placed, card.number + 1, now))
      return card
    })
  }

  updateCard(
    project: ProjectPath,
    number: CardNumber,
    input: UpdateCardInput,
  ): Promise<TaskBoardOutcome<Card>> {
    return this.#mutate(project, async (path) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      if (input.title === undefined && input.description === undefined) {
        fail("invalid_input", "Give a title, a description, or both.")
      }
      const fields: UpdateCardInput = {
        ...(input.title === undefined
          ? {}
          : { title: requiredText(input.title, "A card title must not be empty.") }),
        ...(input.description === undefined ? {} : { description: input.description.trim() }),
      }
      const updated = cardWithFields(card, fields, this.#clock.now())
      await this.#store.saveCard(updated)
      return updated
    })
  }

  moveCard(
    project: ProjectPath,
    number: CardNumber,
    input: MoveCardInput,
  ): Promise<TaskBoardOutcome<Card>> {
    return this.#mutate(project, async (path, board) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      const column = columnOf(board, input.columnId)
      if (column === undefined) {
        fail("column_not_found", `Column "${input.columnId}" does not exist in this board.`)
      }
      const remaining = column.cardNumbers.filter((candidate) => candidate !== card.number).length
      const index =
        input.index === undefined ? remaining : indexWithin(input.index, remaining, "column")
      await this.#store.saveBoard(
        boardWithCardAt(board, card.number, column.id, index, this.#clock.now()),
      )
      return card
    })
  }

  deleteCard(project: ProjectPath, number: CardNumber): Promise<TaskBoardOutcome<null>> {
    return this.#mutate(project, async (path, board) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      await this.#store.saveBoard(boardWithoutCard(board, card.number, this.#clock.now()))
      await this.#store.deleteCard(path, card.number)
      return null
    })
  }

  addComment(
    project: ProjectPath,
    number: CardNumber,
    body: string,
    author: Author,
  ): Promise<TaskBoardOutcome<Comment>> {
    return this.#mutate(project, async (path) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      const text = requiredText(body, "A comment must not be empty.")
      const now = this.#clock.now()
      const comment: Comment = { id: this.#ids.next(), author, body: text, createdAt: now }
      await this.#store.saveCard(cardWithComment(card, comment, now))
      return comment
    })
  }

  deleteComment(
    project: ProjectPath,
    number: CardNumber,
    commentId: CommentId,
  ): Promise<TaskBoardOutcome<null>> {
    return this.#mutate(project, async (path) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      if (!card.comments.some((comment) => comment.id === commentId)) {
        fail("comment_not_found", `Comment "${commentId}" does not exist on card #${number}.`)
      }
      await this.#store.saveCard(cardWithoutComment(card, commentId, this.#clock.now()))
      return null
    })
  }

  linkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<Card>> {
    return this.#mutate(project, async (path) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      const linked = cardWithSession(card, this.#sessionIdOf(sessionId), this.#clock.now())
      if (linked === card) return card
      await this.#store.saveCard(linked)
      return linked
    })
  }

  unlinkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<Card>> {
    return this.#mutate(project, async (path) => {
      const card = this.#cardOf(path, cardNumberOf(number))
      const unlinked = cardWithoutSession(card, this.#sessionIdOf(sessionId), this.#clock.now())
      if (unlinked === card) return card
      await this.#store.saveCard(unlinked)
      return unlinked
    })
  }

  addColumn(project: ProjectPath, title: string): Promise<TaskBoardOutcome<Column>> {
    return this.#mutate(project, async (_path, board) => {
      const text = requiredText(title, "A column title must not be empty.")
      const now = this.#clock.now()
      const id = this.#ids.next()
      if (columnOf(board, id) !== undefined) {
        throw new Error(`The column id "${id}" already exists in this board.`)
      }
      const column: Column = { id, title: { kind: "text", text }, cardNumbers: [] }
      await this.#store.saveBoard(boardWithColumn(board, column, now))
      return column
    })
  }

  renameColumn(
    project: ProjectPath,
    columnId: ColumnId,
    title: string,
  ): Promise<TaskBoardOutcome<Column>> {
    return this.#mutate(project, async (_path, board) => {
      const column = columnOf(board, columnId)
      if (column === undefined) {
        fail("column_not_found", `Column "${columnId}" does not exist in this board.`)
      }
      const text = requiredText(title, "A column title must not be empty.")
      const renamed: Column = { ...column, title: { kind: "text", text } }
      await this.#store.saveBoard(boardWithColumn(board, renamed, this.#clock.now()))
      return renamed
    })
  }

  moveColumn(
    project: ProjectPath,
    columnId: ColumnId,
    index: number,
  ): Promise<TaskBoardOutcome<Board>> {
    return this.#mutate(project, async (_path, board) => {
      const column = columnOf(board, columnId)
      if (column === undefined) {
        fail("column_not_found", `Column "${columnId}" does not exist in this board.`)
      }
      const at = indexWithin(index, board.columns.length - 1, "board")
      const columns = board.columns.filter((candidate) => candidate.id !== columnId)
      columns.splice(at, 0, column)
      const next: Board = { ...board, columns, updatedAt: this.#clock.now() }
      await this.#store.saveBoard(next)
      return next
    })
  }

  deleteColumn(project: ProjectPath, columnId: ColumnId): Promise<TaskBoardOutcome<null>> {
    return this.#mutate(project, async (_path, board) => {
      const column = columnOf(board, columnId)
      if (column === undefined) {
        fail("column_not_found", `Column "${columnId}" does not exist in this board.`)
      }
      if (board.columns.length === 1) {
        fail("last_column", "A board needs at least one column.")
      }
      if (column.cardNumbers.length > 0) {
        fail(
          "column_not_empty",
          `Column "${columnTitleText(column)}" still has ${column.cardNumbers.length} card(s). Move them before you delete the column.`,
        )
      }
      await this.#store.saveBoard(boardWithoutColumn(board, column.id, this.#clock.now()))
      return null
    })
  }

  #run<T>(
    project: ProjectPath,
    operation: (project: ProjectPath) => Promise<T>,
  ): Promise<TaskBoardOutcome<T>> {
    const known = this.#resolver.project(project)
    if (known === undefined) {
      return Promise.resolve({
        status: "error",
        error: {
          code: "project_not_found",
          message: `No project is registered for ${project}.`,
        },
      })
    }
    return this.#queue.run(known.path, async (): Promise<TaskBoardOutcome<T>> => {
      try {
        return { status: "ok", value: await operation(known.path) }
      } catch (error) {
        if (error instanceof TaskBoardOperationError) {
          return { status: "error", error: { code: error.code, message: error.message } }
        }
        throw error
      }
    })
  }

  #mutate<T>(
    project: ProjectPath,
    operation: (project: ProjectPath, board: Board) => Promise<T>,
  ): Promise<TaskBoardOutcome<T>> {
    return this.#run(project, async (path) => {
      const board = await this.#boardOf(path)
      const value = await operation(path, board)
      this.#notify(path)
      return value
    })
  }

  async #boardOf(project: ProjectPath): Promise<Board> {
    const existing = this.#store.board(project)
    if (existing !== undefined) return existing
    const board = createDefaultBoard(project, this.#clock.now())
    await this.#store.saveBoard(board)
    return board
  }

  #cardOf(project: ProjectPath, number: CardNumber): Card {
    const card = this.#store.card(project, number)
    if (card === undefined) {
      fail("card_not_found", `Card #${number} does not exist in this project.`)
    }
    return card
  }

  #sessionIdOf(sessionId: SessionId): SessionId {
    return requiredText(sessionId, "A session id must not be empty.")
  }

  #snapshotOf(project: ProjectPath): BoardSnapshot {
    const board = this.#store.board(project)
    if (board === undefined) {
      throw new Error(`The board of ${project} is missing after it was created.`)
    }
    return { board, cards: this.#store.cards(project) }
  }

  #notify(project: ProjectPath): void {
    const listeners = this.#listeners.get(project)
    if (listeners === undefined) return
    const snapshot = this.#snapshotOf(project)
    for (const listener of [...listeners]) {
      try {
        listener(snapshot)
      } catch (error) {
        void error
      }
    }
  }
}

export function createTaskBoardService(deps: TaskBoardServiceDeps): TaskBoardService {
  return new TaskBoard(deps)
}
