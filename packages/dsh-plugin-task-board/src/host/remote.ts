import type { Context } from "@deepseek-ai/cordis"
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"
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
import { type SessionBoard, TASK_BOARD_SERVICE, type TaskBoardRemoteApi } from "../shared/remote"

const API = Symbol("taskBoardRemoteApi")

export class TaskBoardRemoteService extends TypertRemoteService implements TaskBoardRemoteApi {
  [API]: TaskBoardRemoteApi

  constructor(ctx: Context, api: TaskBoardRemoteApi) {
    super(ctx, TASK_BOARD_SERVICE)
    this[API] = api
  }

  @Remote
  async projects(): Promise<readonly ProjectSummary[]> {
    return await this[API].projects()
  }

  @Remote
  async projectOfSession(sessionId: SessionId): Promise<TaskBoardOutcome<ProjectSummary>> {
    return await this[API].projectOfSession(sessionId)
  }

  @Remote
  async boardOfSession(sessionId: SessionId): Promise<TaskBoardOutcome<SessionBoard>> {
    return await this[API].boardOfSession(sessionId)
  }

  @Remote({ mode: "stream" })
  async *watch(
    project: ProjectPath,
    signal?: AbortSignal,
  ): AsyncIterable<TaskBoardOutcome<BoardSnapshot>> {
    yield* this[API].watch(project, signal)
  }

  @Remote
  async createCard(project: ProjectPath, input: CreateCardInput): Promise<TaskBoardOutcome<Card>> {
    return await this[API].createCard(project, input)
  }

  @Remote
  async updateCard(
    project: ProjectPath,
    number: CardNumber,
    input: UpdateCardInput,
  ): Promise<TaskBoardOutcome<Card>> {
    return await this[API].updateCard(project, number, input)
  }

  @Remote
  async moveCard(
    project: ProjectPath,
    number: CardNumber,
    input: MoveCardInput,
  ): Promise<TaskBoardOutcome<Card>> {
    return await this[API].moveCard(project, number, input)
  }

  @Remote
  async deleteCard(project: ProjectPath, number: CardNumber): Promise<TaskBoardOutcome<null>> {
    return await this[API].deleteCard(project, number)
  }

  @Remote
  async addComment(
    project: ProjectPath,
    number: CardNumber,
    body: string,
  ): Promise<TaskBoardOutcome<Comment>> {
    return await this[API].addComment(project, number, body)
  }

  @Remote
  async deleteComment(
    project: ProjectPath,
    number: CardNumber,
    commentId: CommentId,
  ): Promise<TaskBoardOutcome<null>> {
    return await this[API].deleteComment(project, number, commentId)
  }

  @Remote
  async unlinkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<Card>> {
    return await this[API].unlinkSession(project, number, sessionId)
  }

  @Remote
  async addColumn(project: ProjectPath, title: string): Promise<TaskBoardOutcome<Column>> {
    return await this[API].addColumn(project, title)
  }

  @Remote
  async renameColumn(
    project: ProjectPath,
    columnId: ColumnId,
    title: string,
  ): Promise<TaskBoardOutcome<Column>> {
    return await this[API].renameColumn(project, columnId, title)
  }

  @Remote
  async moveColumn(
    project: ProjectPath,
    columnId: ColumnId,
    index: number,
  ): Promise<TaskBoardOutcome<Board>> {
    return await this[API].moveColumn(project, columnId, index)
  }

  @Remote
  async deleteColumn(project: ProjectPath, columnId: ColumnId): Promise<TaskBoardOutcome<null>> {
    return await this[API].deleteColumn(project, columnId)
  }
}
