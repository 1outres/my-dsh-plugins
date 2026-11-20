import { mkdtemp, realpath, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RegisteredWorkspace } from "../src/contract"
import { CHECK_INTERVAL_MS } from "../src/host/schedule"
import { apply, Config, inject, name } from "../src/index"

const FAKE_METHODS = ["Date", "setTimeout", "clearTimeout"] as const

interface FakeRegistry {
  readonly entries: RegisteredWorkspace[]
  readonly created: string[]
  readonly titles: (string | undefined)[]
  listCalls: number
  list(): readonly RegisteredWorkspace[]
  create(path: string, title?: string): Promise<RegisteredWorkspace>
}

function createRegistry(entries: RegisteredWorkspace[] = []): FakeRegistry {
  let nextId = 1
  return {
    entries,
    created: [],
    titles: [],
    listCalls: 0,
    list() {
      this.listCalls += 1
      return this.entries
    },
    async create(path: string, title?: string) {
      const canonical = await realpath(path)
      const existing = this.entries.find((entry) => entry.path === canonical)
      if (existing !== undefined) return existing
      const workspace = { id: `w${nextId++}`, path: canonical }
      this.entries.unshift(workspace)
      this.created.push(path)
      this.titles.push(title)
      return workspace
    },
  }
}

function createContext(registry = createRegistry()) {
  const info: string[] = []
  const warnings: string[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    logger: {
      info: (message: string) => info.push(message),
      warn: (message: string) => warnings.push(message),
    },
    effect: (run: () => (() => void) | undefined) => {
      const dispose = run()
      if (dispose !== undefined) disposers.push(dispose)
      return dispose
    },
    workspaceRegistry: registry,
  }
  return {
    ctx,
    registry,
    info,
    warnings,
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

const WAIT_LIMIT_MS = 3000

function waitFor(check: () => boolean, report: () => string = () => "condition"): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = process.hrtime.bigint() + BigInt(WAIT_LIMIT_MS) * 1_000_000n
    const poll = () => {
      if (check()) {
        resolve()
        return
      }
      if (process.hrtime.bigint() > deadline) {
        reject(new Error(`${report()} was not met`))
        return
      }
      setImmediate(poll)
    }
    poll()
  })
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "daily-workspace-"))
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe("daily-workspace host entry", () => {
  it("declares its name, service, and default root", () => {
    expect(name).toBe("daily-workspace")
    expect(inject).toEqual(["workspaceRegistry"])
    expect(Config({}).root).toBe("~/Documents")
  })

  it("creates today's folders and registers the year, month, and day", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 9, 30, 0))
    const h = createContext()
    apply(h.ctx as never, { root })
    const day = join(root, "2026", "11", "20")
    await waitFor(
      () => h.registry.created.length === 3,
      () => `3 registrations; info=${h.info.join(" | ")} warnings=${h.warnings.join(" | ")}`,
    )
    expect(h.registry.created).toEqual([join(root, "2026"), join(root, "2026", "11"), day])
    expect(h.registry.titles).toEqual([undefined, undefined, undefined])
    expect((await stat(day)).isDirectory()).toBe(true)
    expect(h.registry.entries.map((entry) => entry.path)).toEqual([
      await realpath(day),
      await realpath(join(root, "2026", "11")),
      await realpath(join(root, "2026")),
    ])
    expect(h.info).toEqual([
      `daily-workspace: created ${day}`,
      `daily-workspace: registered ${join(root, "2026")}`,
      `daily-workspace: registered ${join(root, "2026", "11")}`,
      `daily-workspace: registered ${day}`,
    ])
    expect(h.warnings).toEqual([])
  })

  it("registers nothing new on a second start", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 9, 30, 0))
    const registry = createRegistry()
    const first = createContext(registry)
    apply(first.ctx as never, { root })
    await waitFor(
      () => registry.created.length === 3,
      () =>
        `3 registrations; info=${first.info.join(" | ")} warnings=${first.warnings.join(" | ")}`,
    )
    const second = createContext(registry)
    apply(second.ctx as never, { root })
    await waitFor(
      () => registry.listCalls >= 2,
      () => `the second pass; info=${second.info.join(" | ")}`,
    )
    expect(registry.created).toHaveLength(3)
    expect(second.info).toEqual([])
    expect(second.warnings).toEqual([])
  })

  it("warns once and does nothing for a relative root", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 9, 30, 0))
    const h = createContext()
    apply(h.ctx as never, { root: "Documents" })
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.warnings).toEqual([
      "daily-workspace: root 'Documents' is not an absolute path; nothing is managed",
    ])
    expect(h.registry.created).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("starts no pass while the local date stays the same", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 9, 30, 0))
    const h = createContext()
    apply(h.ctx as never, { root })
    await waitFor(
      () => h.registry.created.length === 3,
      () => `3 registrations; info=${h.info.join(" | ")} warnings=${h.warnings.join(" | ")}`,
    )
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(h.registry.created).toHaveLength(3)
    expect(h.info).toHaveLength(4)
    expect(vi.getTimerCount()).toBe(1)
  })

  it("registers the new day after a long sleep", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 23, 59, 0, 0))
    const h = createContext()
    apply(h.ctx as never, { root })
    await waitFor(
      () => h.registry.created.length === 3,
      () => `3 registrations; info=${h.info.join(" | ")} warnings=${h.warnings.join(" | ")}`,
    )
    // The machine wakes at 09:00; the pending one minute check fires a minute later.
    vi.setSystemTime(new Date(2026, 10, 21, 9, 0, 0))
    await vi.advanceTimersByTimeAsync(60_000)
    const next = join(root, "2026", "11", "21")
    await waitFor(
      () => h.registry.created.length === 4,
      () => `4 registrations; info=${h.info.join(" | ")} warnings=${h.warnings.join(" | ")}`,
    )
    expect(h.registry.created[3]).toBe(next)
    expect((await stat(next)).isDirectory()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
  })

  it("cancels the check timer on dispose", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 9, 30, 0))
    const h = createContext()
    apply(h.ctx as never, { root })
    expect(vi.getTimerCount()).toBe(1)
    h.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("registers the next day after midnight", async () => {
    vi.useFakeTimers({ toFake: [...FAKE_METHODS] })
    vi.setSystemTime(new Date(2026, 10, 20, 23, 59, 59, 0))
    const h = createContext()
    apply(h.ctx as never, { root })
    await waitFor(
      () => h.registry.created.length === 3,
      () => `3 registrations; info=${h.info.join(" | ")} warnings=${h.warnings.join(" | ")}`,
    )
    vi.setSystemTime(new Date(2026, 10, 21, 0, 0, 0, 5))
    await vi.advanceTimersByTimeAsync(1005)
    const next = join(root, "2026", "11", "21")
    await waitFor(
      () => h.registry.created.length === 4,
      () => `4 registrations; info=${h.info.join(" | ")} warnings=${h.warnings.join(" | ")}`,
    )
    expect(h.registry.created[3]).toBe(next)
    expect((await stat(next)).isDirectory()).toBe(true)
  })
})
