import { describe, expect, it, vi } from "vitest"
import { createTaskBoardApi } from "../src/host/api"
import type { SessionDirectoryPort, TaskBoardService } from "../src/host/contract"
import { createTaskBoardService } from "../src/host/service"
import { createBoardStore } from "../src/host/store"
import type { BoardSnapshot, TaskBoardOutcome } from "../src/shared/model"
import {
  buildBoard,
  buildCard,
  createFakeResolver,
  createMemoryTables,
  ok,
  projectSummary,
} from "./host-support"

const PROJECT = projectSummary("/repo", { title: "Repo", workspaceId: "w1" })
const USER = { kind: "user" } as const

function createSessions(
  directory: string | undefined,
  options: { failure?: Error } = {},
): SessionDirectoryPort {
  return {
    directoryOf: async () => {
      if (options.failure !== undefined) throw options.failure
      return directory
    },
    rootSessionOf: (sessionId) => sessionId,
  }
}

interface HarnessOptions {
  readonly directory?: string
  readonly missingDirectory?: boolean
  readonly failure?: Error
}

function createHarness(options: HarnessOptions = {}) {
  const directory =
    options.missingDirectory === true ? undefined : (options.directory ?? "/repo/src")
  const tables = createMemoryTables()
  const store = createBoardStore(tables.boards, tables.cards)
  let sequence = 0
  const service = createTaskBoardService({
    store,
    resolver: createFakeResolver([PROJECT], { "/repo/src": PROJECT }),
    clock: { now: () => 1_000 },
    ids: { next: () => `id-${++sequence}` },
  })
  const sessions = createSessions(directory, { failure: options.failure })
  const api = createTaskBoardApi({ service, sessions })
  return { api, service, store, tables }
}

describe("task board remote api", () => {
  it("lists the projects", async () => {
    const harness = createHarness()
    await expect(harness.api.projects()).resolves.toEqual([PROJECT])
  })

  it("resolves the project of a session", async () => {
    const harness = createHarness()
    await expect(harness.api.projectOfSession("s1")).resolves.toEqual(ok(PROJECT))
  })

  it("reports a session without a directory", async () => {
    const harness = createHarness({ missingDirectory: true })

    const outcome = await harness.api.projectOfSession("s1")

    expect(outcome.status).toBe("error")
    expect(outcome.status === "error" ? outcome.error.code : undefined).toBe("session_not_found")
  })

  it("reports a session that cannot be inspected", async () => {
    const harness = createHarness({ failure: new Error("storage is down") })

    const outcome = await harness.api.projectOfSession("s1")

    expect(outcome).toEqual({
      status: "error",
      error: {
        code: "session_not_found",
        message: "Cannot read the directory of session s1: storage is down",
      },
    })
  })

  it("opens the board of a session", async () => {
    const harness = createHarness()

    const outcome = await harness.api.boardOfSession("s1")

    expect(outcome.status).toBe("ok")
    if (outcome.status !== "ok") return
    expect(outcome.value.project).toEqual(PROJECT)
    expect(outcome.value.snapshot.board.project).toBe("/repo")
    expect(outcome.value.snapshot.cards).toEqual([])
  })

  it("returns the project error of a session outside every project", async () => {
    const harness = createHarness({ directory: "/elsewhere" })

    const outcome = await harness.api.boardOfSession("s1")

    expect(outcome.status).toBe("error")
    expect(outcome.status === "error" ? outcome.error.code : undefined).toBe("project_not_found")
  })

  it("writes board changes as the user", async () => {
    const harness = createHarness()

    const created = await harness.api.createCard("/repo", { title: "First", description: "" })
    expect(created.status === "ok" ? created.value.createdBy : undefined).toEqual(USER)
    const comment = await harness.api.addComment("/repo", 1, "A note")
    expect(comment.status === "ok" ? comment.value.author : undefined).toEqual(USER)
  })

  it("delegates the other board operations", async () => {
    const harness = createHarness()
    await harness.api.createCard("/repo", { title: "First", description: "Body" })

    const updated = await harness.api.updateCard("/repo", 1, { title: "Second" })
    expect(updated.status === "ok" ? updated.value.title : undefined).toBe("Second")
    const moved = await harness.api.moveCard("/repo", 1, { columnId: "done" })
    expect(moved.status).toBe("ok")
    const column = await harness.api.addColumn("/repo", "Review")
    expect(column.status === "ok" ? column.value.id : undefined).toBe("id-1")
    const renamed = await harness.api.renameColumn("/repo", "id-1", "Checked")
    expect(renamed.status === "ok" ? renamed.value.title : undefined).toEqual({
      kind: "text",
      text: "Checked",
    })
    const added = await harness.api.addColumn("/repo", "Later")
    const laterId = added.status === "ok" ? added.value.id : ""
    const reordered = await harness.api.moveColumn("/repo", laterId, 0)
    expect(reordered.status).toBe("ok")
    const removed = await harness.api.deleteColumn("/repo", laterId)
    expect(removed).toEqual({ status: "ok", value: null })
    const linked = await harness.api.unlinkSession("/repo", 1, "s1")
    expect(linked.status).toBe("ok")
    const deleted = await harness.api.deleteCard("/repo", 1)
    expect(deleted).toEqual({ status: "ok", value: null })
  })

  it("deletes a comment", async () => {
    const harness = createHarness()
    await harness.api.createCard("/repo", { title: "First", description: "" })
    const comment = await harness.api.addComment("/repo", 1, "A note")
    const commentId = comment.status === "ok" ? comment.value.id : ""

    await expect(harness.api.deleteComment("/repo", 1, commentId)).resolves.toEqual({
      status: "ok",
      value: null,
    })
  })
})

describe("task board remote watch", () => {
  function createWatchHarness(initial: TaskBoardOutcome<BoardSnapshot>) {
    let listener: ((snapshot: BoardSnapshot) => void) | undefined
    const unsubscribe = vi.fn()
    const snapshot = vi.fn(async () => initial)
    const service = {
      snapshot,
      watch: vi.fn((_project: string, next: (value: BoardSnapshot) => void) => {
        listener = next
        return unsubscribe
      }),
    } as unknown as TaskBoardService
    const api = createTaskBoardApi({ service, sessions: createSessions("/repo/src") })
    return { api, snapshot, unsubscribe, push: (value: BoardSnapshot) => listener?.(value) }
  }

  const SNAPSHOT: BoardSnapshot = { board: buildBoard(), cards: [buildCard()] }
  const NEXT: BoardSnapshot = {
    board: buildBoard({ updatedAt: 2_000 }),
    cards: [buildCard({ title: "Next" })],
  }

  it("yields the current snapshot and then every change", async () => {
    const harness = createWatchHarness(ok(SNAPSHOT))
    const iterator = harness.api.watch("/repo")[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: ok(SNAPSHOT) })
    const update = iterator.next()
    harness.push(NEXT)
    await expect(update).resolves.toEqual({ done: false, value: ok(NEXT) })

    await iterator.return?.()
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("ends the stream when the signal aborts", async () => {
    const harness = createWatchHarness(ok(SNAPSHOT))
    const controller = new AbortController()
    const iterator = harness.api.watch("/repo", controller.signal)[Symbol.asyncIterator]()
    await iterator.next()

    const pending = iterator.next()
    controller.abort()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("yields a project error and then ends", async () => {
    const failure: TaskBoardOutcome<BoardSnapshot> = {
      status: "error",
      error: { code: "project_not_found", message: "No project is registered for /nope." },
    }
    const harness = createWatchHarness(failure)
    const iterator = harness.api.watch("/nope")[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: failure })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
