import type {
  Card,
  CardNumber,
  ColumnId,
  Comment,
  CommentId,
  MoveCardInput,
  ProjectPath,
  SessionId,
  UpdateCardInput,
} from "../shared/model"
import type { TaskBoardBridge } from "./bridge"
import type { TaskBoardFailure, TaskBoardResult } from "./types"

export interface BoardActions {
  createCard(columnId: ColumnId, title: string): Promise<boolean>
  addColumn(title: string): Promise<boolean>
  renameColumn(columnId: ColumnId, title: string): Promise<boolean>
  moveColumn(columnId: ColumnId, index: number): Promise<boolean>
  deleteColumn(columnId: ColumnId): Promise<boolean>
  moveCard(number: CardNumber, columnId: ColumnId, index: number | undefined): Promise<boolean>
}

export interface CardActions {
  save(number: CardNumber, input: UpdateCardInput): Promise<TaskBoardResult<Card>>
  moveTo(number: CardNumber, columnId: ColumnId): Promise<TaskBoardResult<Card>>
  addComment(number: CardNumber, body: string): Promise<TaskBoardResult<Comment>>
  deleteComment(number: CardNumber, commentId: CommentId): Promise<TaskBoardResult<null>>
  unlinkSession(number: CardNumber, sessionId: SessionId): Promise<TaskBoardResult<Card>>
  deleteCard(number: CardNumber): Promise<TaskBoardResult<null>>
}

export type FailureReport = (failure: TaskBoardFailure | undefined) => void

function moveInput(columnId: ColumnId, index: number | undefined): MoveCardInput {
  return index === undefined ? { columnId } : { columnId, index }
}

export function createBoardActions(
  bridge: TaskBoardBridge,
  project: ProjectPath,
  report: FailureReport,
): BoardActions {
  const run = async (result: Promise<TaskBoardResult<unknown>>): Promise<boolean> => {
    const settled = await result
    report(settled.status === "error" ? settled.error : undefined)
    return settled.status === "ok"
  }
  return {
    createCard: (columnId, title) =>
      run(bridge.createCard(project, { title, description: "", columnId })),
    addColumn: (title) => run(bridge.addColumn(project, title)),
    renameColumn: (columnId, title) => run(bridge.renameColumn(project, columnId, title)),
    moveColumn: (columnId, index) => run(bridge.moveColumn(project, columnId, index)),
    deleteColumn: (columnId) => run(bridge.deleteColumn(project, columnId)),
    moveCard: (number, columnId, index) =>
      run(bridge.moveCard(project, number, moveInput(columnId, index))),
  }
}

export function createCardActions(bridge: TaskBoardBridge, project: ProjectPath): CardActions {
  return {
    save: (number, input) => bridge.updateCard(project, number, input),
    moveTo: (number, columnId) => bridge.moveCard(project, number, moveInput(columnId, undefined)),
    addComment: (number, body) => bridge.addComment(project, number, body),
    deleteComment: (number, commentId) => bridge.deleteComment(project, number, commentId),
    unlinkSession: (number, sessionId) => bridge.unlinkSession(project, number, sessionId),
    deleteCard: (number) => bridge.deleteCard(project, number),
  }
}
