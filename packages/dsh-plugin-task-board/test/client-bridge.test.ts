import { describe, expect, it, vi } from "vitest"
import { createTaskBoardBridge } from "../src/client/bridge"
import type {
  ClientContext,
  CommandsRemote,
  RemoteResult,
  TaskBoardRemote,
  TaskBoardStreamHandle,
} from "../src/client/types"
import type { Card, CreateCardInput, TaskBoardOutcome } from "../src/shared/model"
import { TASK_BOARD_PACKAGE } from "../src/shared/remote"
import {
  CARD_ONE,
  type ControlledStream,
  controlledStream,
  failure,
  outcome,
  PROJECT,
  SESSION_BOARD,
  SNAPSHOT,
} from "./client-support"

interface Descriptor {
  readonly method: string
  readonly mode?: string
  readonly parameters: readonly { readonly name: string; readonly wire?: string }[]
  readonly cancellation?: { readonly parameter: string }
}

interface HarnessOptions {
  mount?: (contribution: unknown) => Promise<() => Promise<void>>
  endImmediately?: boolean
  watchBehavior?: (index: number, stream: ControlledStream) => void
  remote?: Partial<TaskBoardRemote>
}

function harness(options: HarnessOptions = {}) {
  const streams: ControlledStream[] = []
  const unmount = vi.fn(async () => {})
  const mount = vi.fn<(contribution: unknown) => Promise<() => Promise<void>>>(async () => unmount)
  if (options.mount !== undefined) mount.mockImplementation(options.mount)
  const watch = vi.fn((_project: string, _signal?: AbortSignal): TaskBoardStreamHandle => {
    const stream = controlledStream()
    streams.push(stream)
    if (options.endImmediately === true) stream.end()
    options.watchBehavior?.(streams.length - 1, stream)
    return stream.handle
  })
  const remote: TaskBoardRemote = {
    projects: async () => ({ ok: true, value: [PROJECT] }),
    projectOfSession: async () => ({ ok: true, value: outcome(PROJECT) }),
    boardOfSession: async () => ({ ok: true, value: outcome(SESSION_BOARD) }),
    watch,
    createCard: async () => ({ ok: true, value: outcome(CARD_ONE) }),
    updateCard: async () => ({ ok: true, value: outcome(CARD_ONE) }),
    moveCard: async () => ({ ok: true, value: outcome(CARD_ONE) }),
    deleteCard: async () => ({ ok: true, value: outcome(null) }),
    addComment: async () => ({
      ok: true,
      value: outcome(CARD_ONE.comments[0] as NonNullable<(typeof CARD_ONE.comments)[number]>),
    }),
    deleteComment: async () => ({ ok: true, value: outcome(null) }),
    unlinkSession: async () => ({ ok: true, value: outcome(CARD_ONE) }),
    addColumn: async () => ({
      ok: true,
      value: outcome({
        id: "new",
        title: { kind: "text", text: "New" },
        cardNumbers: [],
      }),
    }),
    renameColumn: async () => ({
      ok: true,
      value: outcome({
        id: "todo",
        title: { kind: "text", text: "New" },
        cardNumbers: [],
      }),
    }),
    moveColumn: async () => ({ ok: true, value: outcome({ ...SNAPSHOT.board }) }),
    deleteColumn: async () => ({ ok: true, value: outcome(null) }),
    ...options.remote,
  }
  const commands: CommandsRemote = {
    execute: async () => ({ ok: true, value: undefined }),
  }
  const ctx = {
    effect: () => {},
    get: (name: string) => (name === "remote.taskBoard" ? remote : undefined),
    inject: () => {},
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    remote: { $mount: mount, commands },
    layout: { selectPanel: () => {} },
  } as unknown as ClientContext
  return { ctx, mount, unmount, streams, remote, watch }
}

describe("task board bridge", () => {
  it("mounts one descriptor for every Remote method", async () => {
    const h = harness()
    const bridge = createTaskBoardBridge(h.ctx)
    await bridge.projects()
    expect(h.mount).toHaveBeenCalledTimes(1)
    const contribution = h.mount.mock.calls[0]?.[0] as {
      package: string
      descriptors: readonly Descriptor[]
    }
    expect(contribution.package).toBe(TASK_BOARD_PACKAGE)
    expect(contribution.descriptors.map((descriptor) => descriptor.method).sort()).toEqual([
      "addColumn",
      "addComment",
      "boardOfSession",
      "createCard",
      "deleteCard",
      "deleteColumn",
      "deleteComment",
      "moveCard",
      "moveColumn",
      "projectOfSession",
      "projects",
      "renameColumn",
      "unlinkSession",
      "updateCard",
      "watch",
    ])
    const watch = contribution.descriptors.find((descriptor) => descriptor.method === "watch")
    expect(watch).toMatchObject({
      mode: "stream",
      cancellation: { parameter: "signal" },
      parameters: [{ name: "project", wire: "project" }],
    })
    const createCard = contribution.descriptors.find(
      (descriptor) => descriptor.method === "createCard",
    )
    expect(createCard?.parameters.map((parameter) => parameter.name)).toEqual(["project", "input"])
    bridge.dispose()
  })

  it("unwraps project calls and reports transport failures", async () => {
    const projects = vi.fn<() => Promise<RemoteResult<readonly (typeof PROJECT)[]>>>(async () => ({
      ok: true,
      value: [PROJECT],
    }))
    const h = harness({ remote: { projects } })
    const bridge = createTaskBoardBridge(h.ctx)
    await expect(bridge.projects()).resolves.toEqual({ status: "ok", value: [PROJECT] })
    projects.mockResolvedValueOnce({
      ok: false,
      error: { code: "gateway/internal", message: "offline" },
    })
    await expect(bridge.projects()).resolves.toEqual({
      status: "error",
      error: { code: "gateway/internal", message: "offline" },
    })
    projects.mockRejectedValueOnce(new Error("offline"))
    await expect(bridge.projects()).resolves.toEqual({
      status: "error",
      error: { code: "transport", message: "offline" },
    })
    bridge.dispose()
  })

  it("turns a business outcome into the same status", async () => {
    const createCard = vi.fn<
      (project: string, input: CreateCardInput) => Promise<RemoteResult<TaskBoardOutcome<Card>>>
    >(async () => ({ ok: true, value: outcome(CARD_ONE) }))
    const h = harness({ remote: { createCard } })
    const bridge = createTaskBoardBridge(h.ctx)
    await expect(bridge.createCard(PROJECT.path, { title: "x", description: "" })).resolves.toEqual(
      { status: "ok", value: CARD_ONE },
    )
    createCard.mockResolvedValueOnce({
      ok: true,
      value: failure("card_not_found", "no such card"),
    })
    await expect(bridge.createCard(PROJECT.path, { title: "x", description: "" })).resolves.toEqual(
      { status: "error", error: { code: "card_not_found", message: "no such card" } },
    )
    createCard.mockRejectedValueOnce(new Error("offline"))
    await expect(bridge.createCard(PROJECT.path, { title: "x", description: "" })).resolves.toEqual(
      { status: "error", error: { code: "transport", message: "offline" } },
    )
    bridge.dispose()
  })

  it("streams snapshots, reports business errors, and reconnects with backoff", async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const bridge = createTaskBoardBridge(h.ctx, { baseDelayMs: 100, maxDelayMs: 400 })
      const onSnapshot = vi.fn()
      const onError = vi.fn()
      const stop = bridge.watch(PROJECT.path, onSnapshot, onError)
      await vi.advanceTimersByTimeAsync(0)
      expect(h.streams).toHaveLength(1)
      h.streams[0]?.push(outcome(SNAPSHOT))
      await vi.advanceTimersByTimeAsync(0)
      expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOT)
      h.streams[0]?.push(failure("project_not_found", "gone"))
      await vi.advanceTimersByTimeAsync(0)
      expect(onError).toHaveBeenCalledWith({ code: "project_not_found", message: "gone" })
      h.streams[0]?.end()
      await vi.advanceTimersByTimeAsync(99)
      expect(h.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.streams).toHaveLength(2)
      stop()
      expect(h.streams[1]?.disposed).toBe(true)
      h.streams[1]?.end()
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.streams).toHaveLength(2)
      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports a stream failure and keeps reconnecting", async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const bridge = createTaskBoardBridge(h.ctx, { baseDelayMs: 100, maxDelayMs: 400 })
      const onError = vi.fn()
      const stop = bridge.watch(PROJECT.path, () => {}, onError)
      await vi.advanceTimersByTimeAsync(0)
      h.streams[0]?.fail(new Error("offline"))
      await vi.advanceTimersByTimeAsync(0)
      expect(onError).toHaveBeenCalledWith({ code: "transport", message: "offline" })
      await vi.advanceTimersByTimeAsync(100)
      expect(h.streams).toHaveLength(2)
      stop()
      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("backs off to the cap while no snapshot arrives", async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ endImmediately: true })
      const bridge = createTaskBoardBridge(h.ctx, { baseDelayMs: 100, maxDelayMs: 400 })
      const stop = bridge.watch(
        PROJECT.path,
        () => {},
        () => {},
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(h.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(99)
      expect(h.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(199)
      expect(h.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.streams).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(399)
      expect(h.streams).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.streams).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(400)
      expect(h.streams).toHaveLength(5)
      stop()
      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("resets the backoff after a snapshot", async () => {
    vi.useFakeTimers()
    try {
      const h = harness({
        watchBehavior: (index, stream) => {
          if (index === 1) {
            stream.push(outcome(SNAPSHOT))
          }
          stream.end()
        },
      })
      const bridge = createTaskBoardBridge(h.ctx, { baseDelayMs: 100, maxDelayMs: 400 })
      const stop = bridge.watch(
        PROJECT.path,
        () => {},
        () => {},
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(h.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(100)
      expect(h.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(100)
      expect(h.streams).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(100)
      expect(h.streams).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(199)
      expect(h.streams).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.streams).toHaveLength(5)
      stop()
      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports a mount failure as a transport error and retries on the next call", async () => {
    const mount = vi
      .fn<(contribution: unknown) => Promise<() => Promise<void>>>()
      .mockRejectedValueOnce(new Error("no host"))
      .mockResolvedValueOnce(async () => {})
    const h = harness({ mount })
    const bridge = createTaskBoardBridge(h.ctx)
    await expect(bridge.projects()).resolves.toEqual({
      status: "error",
      error: { code: "transport", message: "no host" },
    })
    await expect(bridge.projects()).resolves.toEqual({ status: "ok", value: [PROJECT] })
    expect(mount).toHaveBeenCalledTimes(2)
    bridge.dispose()
  })

  it("unmounts on dispose", async () => {
    const h = harness()
    const bridge = createTaskBoardBridge(h.ctx)
    await bridge.projects()
    bridge.dispose()
    await vi.waitFor(() => expect(h.unmount).toHaveBeenCalledTimes(1))
  })
})
