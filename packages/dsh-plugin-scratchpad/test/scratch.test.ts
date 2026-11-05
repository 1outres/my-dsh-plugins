import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createScratchStarter,
  ERROR_HOLD_MS,
  nameTaken,
  REGISTER_TIMEOUT_MS,
  reusableScratch,
  type ScratchDeps,
  ScratchRootError,
  startScratch,
  waitForWorkspace,
} from "../src/client/scratch"
import type {
  Observable,
  SessionListState,
  WorkspaceSnapshot,
  WorkspaceView,
} from "../src/client/types"

const ROOT = "/home/me/.dsh/scratchpad"

function workspace(
  name: string,
  sessionIds: string[],
  createdAt: string,
  path = `${ROOT}/${name}`,
): WorkspaceView {
  return { workspaceId: `ws-${name}`, path, title: name, sessionIds, createdAt }
}

function snapshot(items: WorkspaceView[], archivedSessionIds: string[] = []): WorkspaceSnapshot {
  return { items, archivedSessionIds }
}

function sessions(rows: Record<string, { cwd?: string; blank: boolean }>): SessionListState {
  return { byId: rows }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("reusing the newest scratch", () => {
  const older = workspace("2026-11-01-100000", ["old"], "2026-11-01T01:00:00Z")
  const newer = workspace("2026-11-05-100000", ["new"], "2026-11-05T01:00:00Z")
  const project = workspace("project", ["p"], "2026-11-06T01:00:00Z", "/home/me/project")

  it("picks the newest scratch while every Session in it is blank", () => {
    const rows = sessions({ old: { blank: true }, new: { blank: true }, p: { blank: true } })
    expect(reusableScratch(snapshot([older, project, newer]), rows, [ROOT])).toBe(newer)
  })

  it("skips reuse once something was sent there", () => {
    const rows = sessions({ old: { blank: true }, new: { blank: false } })
    expect(reusableScratch(snapshot([older, newer]), rows, [ROOT])).toBeUndefined()
  })

  it("skips reuse when a Session is archived or not listed yet", () => {
    const rows = sessions({ new: { blank: true } })
    expect(reusableScratch(snapshot([newer], ["new"]), rows, [ROOT])).toBeUndefined()
    expect(reusableScratch(snapshot([newer]), sessions({}), [ROOT])).toBeUndefined()
  })

  it("reuses a scratch that has no Session", () => {
    const empty = workspace("2026-11-05-100000", [], "2026-11-05T01:00:00Z")
    expect(reusableScratch(snapshot([empty]), sessions({}), [ROOT])).toBe(empty)
  })

  it("does not count the root or unrelated Workspaces as scratches", () => {
    const root = workspace("scratchpad", ["r"], "2026-11-06T01:00:00Z", ROOT)
    const rows = sessions({ r: { blank: true } })
    expect(reusableScratch(snapshot([root, project]), rows, [ROOT])).toBeUndefined()
  })
})

describe("taken names", () => {
  it("counts registered scratches and the cwd of every Session, archived ones included", () => {
    const items = snapshot([workspace("a", [], "2026-11-05T01:00:00Z")])
    const rows = sessions({ s: { cwd: `${ROOT}/b`, blank: false } })
    expect(nameTaken("a", items, rows, [ROOT])).toBe(true)
    expect(nameTaken("b", items, rows, [ROOT])).toBe(true)
    expect(nameTaken("c", items, rows, [ROOT])).toBe(false)
  })
})

function createDeps(overrides: Partial<ScratchDeps> = {}) {
  const calls: string[] = []
  const deps: ScratchDeps = {
    root: () => ROOT,
    workspaces: () => snapshot([]),
    sessions: () => sessions({}),
    createSession: async (cwd) => {
      calls.push(`create ${cwd}`)
      return "new-session"
    },
    openWorkspace: async (id) => {
      calls.push(`open workspace ${id}`)
    },
    openSession: (id) => {
      calls.push(`open session ${id}`)
    },
    waitForWorkspace: async (id, timeoutMs) => {
      calls.push(`wait ${id} ${timeoutMs}`)
      return "ws-new"
    },
    now: () => new Date(2026, 10, 5, 23, 13, 6),
    ...overrides,
  }
  return { deps, calls }
}

describe("starting a scratch", () => {
  it("creates a Session in a new directory and opens its Workspace", async () => {
    const { deps, calls } = createDeps()
    await startScratch(deps)
    expect(calls).toEqual([
      `create ${ROOT}/2026-11-05-231306`,
      `wait new-session ${REGISTER_TIMEOUT_MS}`,
      "open workspace ws-new",
    ])
  })

  it("adds a suffix when the name is taken", async () => {
    const { deps, calls } = createDeps({
      sessions: () => sessions({ s: { cwd: `${ROOT}/2026-11-05-231306`, blank: false } }),
    })
    await startScratch(deps)
    expect(calls[0]).toBe(`create ${ROOT}/2026-11-05-231306-2`)
  })

  it("opens the unused newest scratch instead of creating one", async () => {
    const unused = workspace("a", ["s"], "2026-11-05T01:00:00Z")
    const { deps, calls } = createDeps({
      workspaces: () => snapshot([unused]),
      sessions: () => sessions({ s: { cwd: `${ROOT}/a`, blank: true } }),
    })
    await startScratch(deps)
    expect(calls).toEqual(["open workspace ws-a"])
  })

  it("opens the Session itself when the Host half never registers the scratch", async () => {
    const { deps, calls } = createDeps({ waitForWorkspace: async () => undefined })
    await startScratch(deps)
    expect(calls.at(-1)).toBe("open session new-session")
  })

  it("refuses without a resolvable root", async () => {
    const { deps, calls } = createDeps({ root: () => undefined })
    await expect(startScratch(deps)).rejects.toBeInstanceOf(ScratchRootError)
    expect(calls).toEqual([])
  })
})

describe("the starter behind the buttons", () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key} ${JSON.stringify(params)}`

  it("reports busy and joins a second click", async () => {
    let release: (id: string) => void = () => {}
    const { deps } = createDeps({
      createSession: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    const starter = createScratchStarter(deps, { t, warn: () => {} })
    const seen: boolean[] = []
    starter.status.subscribe(() => seen.push(starter.status.getSnapshot().busy))
    const first = starter.start()
    expect(starter.start()).toBe(first)
    release("new-session")
    await first
    expect(seen).toEqual([true, false])
  })

  it("shows a failure for a while, then clears it", async () => {
    vi.useFakeTimers()
    const warn = vi.fn()
    const { deps } = createDeps({
      createSession: async () => {
        throw new Error("boom")
      },
    })
    const starter = createScratchStarter(deps, { t, warn })
    await starter.start()
    expect(starter.status.getSnapshot()).toEqual({
      busy: false,
      error: 'error.create {"detail":"boom"}',
    })
    expect(warn).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(ERROR_HOLD_MS)
    expect(starter.status.getSnapshot().error).toBeUndefined()
  })

  it("names an unresolved root", async () => {
    const { deps } = createDeps({ root: () => undefined })
    const starter = createScratchStarter(deps, { t, warn: () => {} })
    await starter.start()
    expect(starter.status.getSnapshot().error).toBe("error.root")
    starter.dispose()
  })
})

describe("waiting for registration", () => {
  function list(initial: WorkspaceSnapshot) {
    let current = initial
    const listeners = new Set<() => void>()
    const observable: Observable<WorkspaceSnapshot> = {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    return {
      observable,
      listeners,
      set(next: WorkspaceSnapshot) {
        current = next
        for (const listener of [...listeners]) listener()
      },
    }
  }

  it("resolves when the Session shows up in a Workspace", async () => {
    const source = list(snapshot([]))
    const pending = waitForWorkspace(source.observable, "s", 1_000)
    source.set(snapshot([workspace("a", ["s"], "2026-11-05T01:00:00Z")]))
    await expect(pending).resolves.toBe("ws-a")
    expect(source.listeners.size).toBe(0)
  })

  it("gives up after the timeout", async () => {
    vi.useFakeTimers()
    const source = list(snapshot([]))
    const pending = waitForWorkspace(source.observable, "s", 1_000)
    vi.advanceTimersByTime(1_000)
    await expect(pending).resolves.toBeUndefined()
    expect(source.listeners.size).toBe(0)
  })
})
