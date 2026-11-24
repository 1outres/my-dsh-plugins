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
import { type SessionBoard, TASK_BOARD_PACKAGE, TASK_BOARD_SERVICE } from "../shared/remote"
import type {
  ClientContext,
  RemoteResult,
  TaskBoardFailure,
  TaskBoardRemote,
  TaskBoardResult,
  TaskBoardStreamHandle,
} from "./types"

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

const jsonCodec = {
  mode: "strict" as const,
  typeSymbol: `${TASK_BOARD_PACKAGE}/json`,
  create: () => ({ parse: (value: unknown) => value }),
}

function parameter(name: string) {
  return { name, wire: name, source: "json" as const, codec: jsonCodec }
}

function descriptor(
  name: string,
  parameters: readonly ReturnType<typeof parameter>[] = [],
  extra: Record<string, unknown> = {},
) {
  return {
    id: `${TASK_BOARD_PACKAGE}#${name}`,
    service: TASK_BOARD_SERVICE,
    namespace: TASK_BOARD_SERVICE,
    method: name,
    invocation: { kind: "direct" as const },
    parameters,
    result: jsonCodec,
    ...extra,
  }
}

export const TASK_BOARD_CONTRIBUTION = {
  package: TASK_BOARD_PACKAGE,
  descriptors: [
    descriptor("projects"),
    descriptor("projectOfSession", [parameter("sessionId")]),
    descriptor("boardOfSession", [parameter("sessionId")]),
    descriptor("watch", [parameter("project")], {
      mode: "stream",
      cancellation: { parameter: "signal" },
    }),
    descriptor("createCard", [parameter("project"), parameter("input")]),
    descriptor("updateCard", [parameter("project"), parameter("number"), parameter("input")]),
    descriptor("moveCard", [parameter("project"), parameter("number"), parameter("input")]),
    descriptor("deleteCard", [parameter("project"), parameter("number")]),
    descriptor("addComment", [parameter("project"), parameter("number"), parameter("body")]),
    descriptor("deleteComment", [
      parameter("project"),
      parameter("number"),
      parameter("commentId"),
    ]),
    descriptor("unlinkSession", [
      parameter("project"),
      parameter("number"),
      parameter("sessionId"),
    ]),
    descriptor("addColumn", [parameter("project"), parameter("title")]),
    descriptor("renameColumn", [parameter("project"), parameter("columnId"), parameter("title")]),
    descriptor("moveColumn", [parameter("project"), parameter("columnId"), parameter("index")]),
    descriptor("deleteColumn", [parameter("project"), parameter("columnId")]),
  ],
}

export interface TaskBoardBridgeOptions {
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
}

export interface TaskBoardBridge {
  projects(): Promise<TaskBoardResult<readonly ProjectSummary[]>>
  projectOfSession(sessionId: SessionId): Promise<TaskBoardResult<ProjectSummary>>
  boardOfSession(sessionId: SessionId): Promise<TaskBoardResult<SessionBoard>>
  createCard(project: ProjectPath, input: CreateCardInput): Promise<TaskBoardResult<Card>>
  updateCard(
    project: ProjectPath,
    number: CardNumber,
    input: UpdateCardInput,
  ): Promise<TaskBoardResult<Card>>
  moveCard(
    project: ProjectPath,
    number: CardNumber,
    input: MoveCardInput,
  ): Promise<TaskBoardResult<Card>>
  deleteCard(project: ProjectPath, number: CardNumber): Promise<TaskBoardResult<null>>
  addComment(
    project: ProjectPath,
    number: CardNumber,
    body: string,
  ): Promise<TaskBoardResult<Comment>>
  deleteComment(
    project: ProjectPath,
    number: CardNumber,
    commentId: CommentId,
  ): Promise<TaskBoardResult<null>>
  unlinkSession(
    project: ProjectPath,
    number: CardNumber,
    sessionId: SessionId,
  ): Promise<TaskBoardResult<Card>>
  addColumn(project: ProjectPath, title: string): Promise<TaskBoardResult<Column>>
  renameColumn(
    project: ProjectPath,
    columnId: ColumnId,
    title: string,
  ): Promise<TaskBoardResult<Column>>
  moveColumn(
    project: ProjectPath,
    columnId: ColumnId,
    index: number,
  ): Promise<TaskBoardResult<Board>>
  deleteColumn(project: ProjectPath, columnId: ColumnId): Promise<TaskBoardResult<null>>
  watch(
    project: ProjectPath,
    onSnapshot: (snapshot: BoardSnapshot) => void,
    onError: (error: TaskBoardFailure) => void,
  ): () => void
  dispose(): void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function transportFailure(error: unknown): TaskBoardFailure {
  return {
    code: "transport",
    message: error instanceof Error ? error.message : String(error),
  }
}

function settle<T>(result: RemoteResult<TaskBoardOutcome<T>>): TaskBoardResult<T> {
  if (!result.ok) return { status: "error", error: result.error }
  return result.value
}

export function createTaskBoardBridge(
  ctx: ClientContext,
  options: TaskBoardBridgeOptions = {},
): TaskBoardBridge {
  const baseDelayMs = options.baseDelayMs ?? BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS
  const watchers = new Set<() => void>()
  let disposed = false
  let mounting: Promise<TaskBoardRemote> | undefined
  let unmount: (() => Promise<void>) | undefined

  const ensureMounted = (): Promise<TaskBoardRemote> => {
    if (mounting !== undefined) return mounting
    const pending = (async () => {
      const dispose = await ctx.remote.$mount(TASK_BOARD_CONTRIBUTION)
      if (disposed) {
        await dispose()
        throw new Error("The task board bridge is disposed")
      }
      unmount = dispose
      const remote = ctx.get(`remote.${TASK_BOARD_SERVICE}`)
      if (remote === undefined) throw new Error("The task board Remote is not mounted")
      return remote as TaskBoardRemote
    })()
    mounting = pending.catch((error: unknown) => {
      mounting = undefined
      throw error
    })
    return mounting
  }

  const call = async <T>(
    run: (remote: TaskBoardRemote) => Promise<RemoteResult<TaskBoardOutcome<T>>>,
  ): Promise<TaskBoardResult<T>> => {
    try {
      const remote = await ensureMounted()
      return settle(await run(remote))
    } catch (error) {
      return { status: "error", error: transportFailure(error) }
    }
  }

  return {
    async projects() {
      try {
        const remote = await ensureMounted()
        const result = await remote.projects()
        if (!result.ok) return { status: "error", error: result.error }
        return { status: "ok", value: result.value }
      } catch (error) {
        return { status: "error", error: transportFailure(error) }
      }
    },
    projectOfSession: (sessionId) => call((remote) => remote.projectOfSession(sessionId)),
    boardOfSession: (sessionId) => call((remote) => remote.boardOfSession(sessionId)),
    createCard: (project, input) => call((remote) => remote.createCard(project, input)),
    updateCard: (project, number, input) =>
      call((remote) => remote.updateCard(project, number, input)),
    moveCard: (project, number, input) => call((remote) => remote.moveCard(project, number, input)),
    deleteCard: (project, number) => call((remote) => remote.deleteCard(project, number)),
    addComment: (project, number, body) =>
      call((remote) => remote.addComment(project, number, body)),
    deleteComment: (project, number, commentId) =>
      call((remote) => remote.deleteComment(project, number, commentId)),
    unlinkSession: (project, number, sessionId) =>
      call((remote) => remote.unlinkSession(project, number, sessionId)),
    addColumn: (project, title) => call((remote) => remote.addColumn(project, title)),
    renameColumn: (project, columnId, title) =>
      call((remote) => remote.renameColumn(project, columnId, title)),
    moveColumn: (project, columnId, index) =>
      call((remote) => remote.moveColumn(project, columnId, index)),
    deleteColumn: (project, columnId) => call((remote) => remote.deleteColumn(project, columnId)),
    watch(project, onSnapshot, onError) {
      let stopped = false
      let handle: TaskBoardStreamHandle | undefined
      let backoffMs = baseDelayMs
      const stop = (): void => {
        if (stopped) return
        stopped = true
        handle?.dispose()
        handle = undefined
        watchers.delete(stop)
      }
      watchers.add(stop)
      const pump = async (): Promise<void> => {
        while (!stopped) {
          let delivered = false
          try {
            const remote = await ensureMounted()
            if (stopped) return
            handle = remote.watch(project)
            for await (const result of handle) {
              if (stopped) break
              if (result.status === "ok") {
                delivered = true
                backoffMs = baseDelayMs
                onSnapshot(result.value)
              } else {
                onError(result.error)
              }
            }
          } catch (error) {
            if (stopped) return
            onError(transportFailure(error))
          } finally {
            handle = undefined
          }
          if (stopped) return
          await delay(backoffMs)
          if (!delivered) backoffMs = Math.min(backoffMs * 2, maxDelayMs)
        }
      }
      void pump()
      return stop
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const stop of [...watchers]) stop()
      watchers.clear()
      const pending = unmount
      unmount = undefined
      void pending?.().catch(() => undefined)
    },
  }
}
