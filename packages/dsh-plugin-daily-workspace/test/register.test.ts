import { describe, expect, it } from "vitest"
import type {
  FsPort,
  LoggerPort,
  RegisteredWorkspace,
  WorkspaceRegistryPort,
} from "../src/contract"
import { registerDailyWorkspace } from "../src/host/register"

class FakeFs implements FsPort {
  readonly dirs = new Set<string>()
  readonly canonical = new Map<string, string>()
  readonly ensured: string[] = []
  failure: Error | undefined

  async ensureDir(path: string): Promise<boolean> {
    if (this.failure !== undefined) throw this.failure
    this.ensured.push(path)
    if (this.dirs.has(path)) return false
    let current = path
    while (true) {
      this.dirs.add(current)
      const at = current.lastIndexOf("/")
      if (at <= 0) break
      current = current.slice(0, at)
    }
    return true
  }

  async realpath(path: string): Promise<string> {
    if (this.failure !== undefined) throw this.failure
    if (!this.dirs.has(path)) throw new Error(`ENOENT: no such file or directory, ${path}`)
    return this.canonical.get(path) ?? path
  }
}

class FakeRegistry implements WorkspaceRegistryPort {
  readonly entries: RegisteredWorkspace[] = []
  readonly created: string[] = []
  readonly titles: (string | undefined)[] = []
  failure: Error | undefined
  private nextId = 1

  list(): readonly RegisteredWorkspace[] {
    return this.entries
  }

  async create(path: string, title?: string): Promise<RegisteredWorkspace> {
    if (this.failure !== undefined) throw this.failure
    const existing = this.entries.find((entry) => entry.path === path)
    if (existing !== undefined) return existing
    const workspace = { id: `w${this.nextId++}`, path }
    this.entries.unshift(workspace)
    this.created.push(path)
    this.titles.push(title)
    return workspace
  }
}

class FakeLogger implements LoggerPort {
  readonly infos: string[] = []
  readonly warnings: string[] = []

  info(message: string): void {
    this.infos.push(message)
  }

  warn(message: string): void {
    this.warnings.push(message)
  }
}

function setup() {
  const fs = new FakeFs()
  const registry = new FakeRegistry()
  const logger = new FakeLogger()
  return {
    fs,
    registry,
    logger,
    run: (date = new Date(2026, 10, 20, 9)) =>
      registerDailyWorkspace({ root: "/srv/docs", registry, fs, logger }, date),
  }
}

describe("daily registration", () => {
  it("creates today's folder and registers the year, month, and day in order", async () => {
    const h = setup()
    await h.run()
    expect(h.fs.ensured).toEqual(["/srv/docs/2026/11/20"])
    expect(h.registry.created).toEqual([
      "/srv/docs/2026",
      "/srv/docs/2026/11",
      "/srv/docs/2026/11/20",
    ])
    expect(h.registry.titles).toEqual([undefined, undefined, undefined])
    expect(h.logger.infos).toEqual([
      "created /srv/docs/2026/11/20",
      "registered /srv/docs/2026",
      "registered /srv/docs/2026/11",
      "registered /srv/docs/2026/11/20",
    ])
    expect(h.logger.warnings).toEqual([])
  })

  it("says nothing and registers nothing on a second run of the same day", async () => {
    const h = setup()
    await h.run()
    h.logger.infos.length = 0
    await h.run()
    expect(h.fs.ensured).toEqual(["/srv/docs/2026/11/20", "/srv/docs/2026/11/20"])
    expect(h.registry.created).toHaveLength(3)
    expect(h.logger.infos).toEqual([])
  })

  it("skips a folder already registered under its canonical path", async () => {
    const h = setup()
    h.fs.canonical.set("/srv/docs/2026", "/data/docs/2026")
    h.registry.entries.push({ id: "w0", path: "/data/docs/2026" })
    await h.run()
    expect(h.registry.created).toEqual(["/srv/docs/2026/11", "/srv/docs/2026/11/20"])
    expect(h.logger.infos).not.toContain("registered /srv/docs/2026")
  })

  it("registers nothing above the root", async () => {
    const h = setup()
    await h.run()
    expect(h.registry.created).not.toContain("/srv")
    expect(h.registry.created).not.toContain("/srv/docs")
  })

  it("logs a warning instead of throwing when the filesystem fails", async () => {
    const h = setup()
    h.fs.failure = new Error("cannot write")
    await expect(h.run()).resolves.toBeUndefined()
    expect(h.registry.created).toEqual([])
    expect(h.logger.warnings).toEqual(["cannot register today's folders: cannot write"])
  })

  it("logs a warning instead of throwing when the registry fails", async () => {
    const h = setup()
    h.registry.failure = new Error("registry is closed")
    await expect(h.run()).resolves.toBeUndefined()
    expect(h.logger.warnings).toEqual(["cannot register today's folders: registry is closed"])
  })
})
