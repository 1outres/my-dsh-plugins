import type { TaskBoardBridge } from "../src/client/bridge"
import { en } from "../src/client/i18n"
import type { TaskBoardResult, TaskBoardStreamHandle, Translate } from "../src/client/types"
import type {
  Board,
  BoardSnapshot,
  Card,
  ProjectSummary,
  TaskBoardErrorCode,
  TaskBoardOutcome,
} from "../src/shared/model"
import type { SessionBoard } from "../src/shared/remote"

export const PROJECT: ProjectSummary = {
  path: "/work/repo",
  title: "repo",
  workspaceId: "workspace-1",
}

export const OTHER_PROJECT: ProjectSummary = {
  path: "/work/other",
  title: "other",
  workspaceId: "workspace-2",
}

export const CARD_ONE: Card = {
  project: PROJECT.path,
  number: 1,
  title: "Write the bridge",
  description: "First line\nSecond line",
  comments: [
    {
      id: "comment-1",
      author: { kind: "user" },
      body: "Looks good",
      createdAt: 1000,
    },
  ],
  sessionIds: ["abcdef123456"],
  createdBy: { kind: "user" },
  createdAt: 10,
  updatedAt: 20,
}

export const CARD_TWO: Card = {
  project: PROJECT.path,
  number: 2,
  title: "Draw the board",
  description: "",
  comments: [],
  sessionIds: [],
  createdBy: { kind: "agent", sessionId: "abcdef123456" },
  createdAt: 11,
  updatedAt: 21,
}

export const CARD_THREE: Card = {
  project: PROJECT.path,
  number: 3,
  title: "Ship it",
  description: "Ready",
  comments: [],
  sessionIds: [],
  createdBy: { kind: "user" },
  createdAt: 12,
  updatedAt: 22,
}

export const CARDS: readonly Card[] = [CARD_ONE, CARD_TWO, CARD_THREE]

export const BOARD: Board = {
  project: PROJECT.path,
  columns: [
    { id: "todo", title: { kind: "preset", preset: "todo" }, cardNumbers: [1, 2] },
    {
      id: "in_progress",
      title: { kind: "preset", preset: "in_progress" },
      cardNumbers: [],
    },
    { id: "done", title: { kind: "text", text: "Shipped" }, cardNumbers: [3] },
  ],
  nextCardNumber: 4,
  createdAt: 10,
  updatedAt: 20,
}

export const SNAPSHOT: BoardSnapshot = { board: BOARD, cards: CARDS }

export const SESSION_BOARD: SessionBoard = { project: PROJECT, snapshot: SNAPSHOT }

export function dictionaryTranslator(dictionary: Record<string, string>): Translate {
  return (key, params) => {
    const text = dictionary[key] ?? key
    if (params === undefined) return text
    return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? `{${name}}`))
  }
}

export const translate: Translate = dictionaryTranslator(en)

export function outcome<T>(value: T): TaskBoardOutcome<T> {
  return { status: "ok", value }
}

export function failure(code: TaskBoardErrorCode, message: string): TaskBoardOutcome<never> {
  return { status: "error", error: { code, message } }
}

export interface ControlledStream {
  readonly handle: TaskBoardStreamHandle
  push(item: TaskBoardOutcome<BoardSnapshot>): void
  end(): void
  fail(error: unknown): void
  readonly disposed: boolean
}

export function controlledStream(): ControlledStream {
  const queue: TaskBoardOutcome<BoardSnapshot>[] = []
  let error: unknown
  let ended = false
  let disposed = false
  let wake: (() => void) | undefined
  const kick = (): void => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }
  const iterator: AsyncIterator<TaskBoardOutcome<BoardSnapshot>> = {
    async next() {
      while (queue.length === 0 && error === undefined && !ended && !disposed) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      if (error !== undefined) {
        const thrown = error
        error = undefined
        throw thrown
      }
      const item = queue.shift()
      if (item !== undefined) return { done: false, value: item }
      return { done: true, value: undefined }
    },
  }
  const handle: TaskBoardStreamHandle = {
    [Symbol.asyncIterator]() {
      return iterator
    },
    dispose() {
      disposed = true
      kick()
    },
  }
  return {
    handle,
    push(item) {
      queue.push(item)
      kick()
    },
    end() {
      ended = true
      kick()
    },
    fail(thrown) {
      error = thrown
      kick()
    },
    get disposed() {
      return disposed
    },
  }
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}
export function fakeBridge(overrides: Partial<TaskBoardBridge> = {}): TaskBoardBridge {
  const unused = async (): Promise<TaskBoardResult<never>> => {
    throw new Error("not used in this test")
  }
  return {
    projects: async () => ({ status: "ok", value: [PROJECT] }),
    projectOfSession: unused,
    boardOfSession: unused,
    createCard: unused,
    updateCard: unused,
    moveCard: unused,
    deleteCard: unused,
    addComment: unused,
    deleteComment: unused,
    unlinkSession: unused,
    addColumn: unused,
    renameColumn: unused,
    moveColumn: unused,
    deleteColumn: unused,
    watch: () => () => {},
    dispose: () => {},
    ...overrides,
  }
}
