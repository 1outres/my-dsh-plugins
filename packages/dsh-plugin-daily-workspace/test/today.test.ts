import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createTodayOpener,
  ERROR_HOLD_MS,
  newestDayWorkspace,
  openToday,
  type TodayDeps,
  TodayFolderError,
  TodayRootError,
} from "../src/client/today"
import type { WorkspaceSnapshot, WorkspaceView } from "../src/client/types"

const ROOT = "/home/me/Documents"

function workspace(workspaceId: string, path: string): WorkspaceView {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return {
    workspaceId,
    path,
    title: name,
    sessionIds: [],
    createdAt: "2026-11-20T00:00:00Z",
  }
}

function snapshot(items: WorkspaceView[]): WorkspaceSnapshot {
  return { items, archivedSessionIds: [] }
}

const older = workspace("ws-old", `${ROOT}/2026/11/19`)
const newer = workspace("ws-new", `${ROOT}/2026/11/20`)
const month = workspace("ws-month", `${ROOT}/2026/11`)
const year = workspace("ws-year", `${ROOT}/2026`)
const project = workspace("ws-project", "/home/me/project")
const otherRoot = workspace("ws-other", `/home/me/Archive/2026/11/20`)

afterEach(() => {
  vi.useRealTimers()
})

describe("picking today's folder", () => {
  it("picks the newest day folder under the root", () => {
    const items = [month, older, project, otherRoot, newer, year]
    expect(newestDayWorkspace(snapshot(items), ROOT)).toBe(newer)
  })

  it("compares dates, not list order", () => {
    const latest = workspace("ws-latest", `${ROOT}/2026/12/01`)
    expect(newestDayWorkspace(snapshot([latest, newer]), ROOT)).toBe(latest)
  })

  it("finds nothing without a day folder under the root", () => {
    expect(newestDayWorkspace(snapshot([month, year, project, otherRoot]), ROOT)).toBeUndefined()
    expect(newestDayWorkspace(snapshot([]), ROOT)).toBeUndefined()
  })
})

function createDeps(overrides: Partial<TodayDeps> = {}) {
  const calls: string[] = []
  const deps: TodayDeps = {
    root: () => ROOT,
    workspaces: () => snapshot([older, newer]),
    openWorkspace: async (workspaceId) => {
      calls.push(`open ${workspaceId}`)
    },
    ...overrides,
  }
  return { deps, calls }
}

describe("opening today", () => {
  it("opens the newest day folder", async () => {
    const { deps, calls } = createDeps()
    await openToday(deps)
    expect(calls).toEqual(["open ws-new"])
  })

  it("refuses without a resolvable root", async () => {
    const { deps, calls } = createDeps({ root: () => undefined })
    await expect(openToday(deps)).rejects.toBeInstanceOf(TodayRootError)
    expect(calls).toEqual([])
  })

  it("refuses when today's folder is not registered", async () => {
    const { deps, calls } = createDeps({ workspaces: () => snapshot([month, year]) })
    await expect(openToday(deps)).rejects.toBeInstanceOf(TodayFolderError)
    expect(calls).toEqual([])
  })

  it("passes an open failure through", async () => {
    const { deps } = createDeps({
      openWorkspace: async () => {
        throw new Error("gone")
      },
    })
    await expect(openToday(deps)).rejects.toThrow("gone")
  })
})

describe("the opener behind the button", () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key} ${JSON.stringify(params)}`

  it("reports busy and joins a second click", async () => {
    let release: () => void = () => {}
    const { deps } = createDeps({
      openWorkspace: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    })
    const opener = createTodayOpener(deps, { t, warn: () => {} })
    const seen: boolean[] = []
    opener.status.subscribe(() => seen.push(opener.status.getSnapshot().busy))
    const first = opener.open()
    expect(opener.open()).toBe(first)
    release()
    await first
    expect(seen).toEqual([true, false])
  })

  it("names each failure on the button", async () => {
    const rootless = createTodayOpener(createDeps({ root: () => undefined }).deps, {
      t,
      warn: () => {},
    })
    await rootless.open()
    expect(rootless.status.getSnapshot().error).toBe("error.root")
    rootless.dispose()

    const empty = createTodayOpener(createDeps({ workspaces: () => snapshot([]) }).deps, {
      t,
      warn: () => {},
    })
    await empty.open()
    expect(empty.status.getSnapshot().error).toBe("error.missing")
    empty.dispose()

    const warn = vi.fn()
    const failing = createTodayOpener(
      createDeps({
        openWorkspace: async () => {
          throw new Error("boom")
        },
      }).deps,
      { t, warn },
    )
    await failing.open()
    expect(failing.status.getSnapshot()).toEqual({
      busy: false,
      error: 'error.open {"detail":"boom"}',
    })
    expect(warn).toHaveBeenCalledOnce()
    failing.dispose()
  })

  it("clears the failure after the hold, or on dispose", async () => {
    vi.useFakeTimers()
    const { deps } = createDeps({
      openWorkspace: async () => {
        throw new Error("boom")
      },
    })
    const opener = createTodayOpener(deps, { t, warn: () => {} })
    await opener.open()
    vi.advanceTimersByTime(ERROR_HOLD_MS)
    expect(opener.status.getSnapshot()).toEqual({ busy: false, error: undefined })
    opener.dispose()

    const held = createTodayOpener(deps, { t, warn: () => {} })
    await held.open()
    held.dispose()
    vi.advanceTimersByTime(ERROR_HOLD_MS)
    expect(held.status.getSnapshot().error).toBe('error.open {"detail":"boom"}')
  })
})
