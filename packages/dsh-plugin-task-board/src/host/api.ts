import type {
  Author,
  BoardSnapshot,
  ProjectPath,
  ProjectSummary,
  SessionId,
  TaskBoardOutcome,
} from "../shared/model"
import type { SessionBoard, TaskBoardRemoteApi } from "../shared/remote"
import { createAsyncQueue } from "./async-queue"
import type { SessionDirectoryPort, TaskBoardService } from "./contract"

export interface TaskBoardApiDeps {
  readonly service: TaskBoardService
  readonly sessions: SessionDirectoryPort
}

const USER: Author = { kind: "user" }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function* watchSnapshots(
  service: TaskBoardService,
  project: ProjectPath,
  signal?: AbortSignal,
): AsyncIterable<TaskBoardOutcome<BoardSnapshot>> {
  const queue = createAsyncQueue<TaskBoardOutcome<BoardSnapshot>>()
  const unsubscribe = service.watch(project, (snapshot) => {
    queue.push({ status: "ok", value: snapshot })
  })
  try {
    const initial = await service.snapshot(project)
    yield initial
    if (initial.status === "error") return
    for (;;) {
      if (signal?.aborted === true) return
      const next = await queue.take(signal)
      if (next === undefined) return
      yield next
    }
  } finally {
    unsubscribe()
    queue.close()
  }
}

export function createTaskBoardApi(deps: TaskBoardApiDeps): TaskBoardRemoteApi {
  const { service, sessions } = deps

  const projectOfSession = async (
    sessionId: SessionId,
  ): Promise<TaskBoardOutcome<ProjectSummary>> => {
    let directory: string | undefined
    try {
      directory = await sessions.directoryOf(sessionId)
    } catch (error) {
      return {
        status: "error",
        error: {
          code: "session_not_found",
          message: `Cannot read the directory of session ${sessionId}: ${messageOf(error)}`,
        },
      }
    }
    if (directory === undefined) {
      return {
        status: "error",
        error: {
          code: "session_not_found",
          message: `Session ${sessionId} has no recorded directory.`,
        },
      }
    }
    return await service.projectOfDirectory(directory)
  }

  const boardOfSession = async (sessionId: SessionId): Promise<TaskBoardOutcome<SessionBoard>> => {
    const project = await projectOfSession(sessionId)
    if (project.status === "error") return project
    const snapshot = await service.snapshot(project.value.path)
    if (snapshot.status === "error") return snapshot
    return { status: "ok", value: { project: project.value, snapshot: snapshot.value } }
  }

  return {
    projects: async () => service.projects(),
    projectOfSession,
    boardOfSession,
    watch: (project, signal) => watchSnapshots(service, project, signal),
    createCard: (project, input) => service.createCard(project, input, USER),
    updateCard: (project, number, input) => service.updateCard(project, number, input),
    moveCard: (project, number, input) => service.moveCard(project, number, input),
    deleteCard: (project, number) => service.deleteCard(project, number),
    addComment: (project, number, body) => service.addComment(project, number, body, USER),
    deleteComment: (project, number, commentId) =>
      service.deleteComment(project, number, commentId),
    unlinkSession: (project, number, sessionId) =>
      service.unlinkSession(project, number, sessionId),
    addColumn: (project, title) => service.addColumn(project, title),
    renameColumn: (project, columnId, title) => service.renameColumn(project, columnId, title),
    moveColumn: (project, columnId, index) => service.moveColumn(project, columnId, index),
    deleteColumn: (project, columnId) => service.deleteColumn(project, columnId),
  }
}
