import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { nodeFs } from "../src/host/fs"
import { Scratchpad, type ScratchpadOptions } from "../src/host/scratchpad"
import type { HeaderLike, RegistryLike, WorkspaceLike } from "../src/host/types"

class FakeWorkspace implements WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string | undefined
  ids: string[] = []
  private readonly headerOf: (id: string) => HeaderLike | undefined

  constructor(
    id: string,
    path: string,
    title: string | undefined,
    headerOf: (id: string) => HeaderLike | undefined,
  ) {
    this.id = id
    this.path = path
    this.title = title
    this.headerOf = headerOf
  }

  get sessionIds(): readonly string[] {
    return this.ids
  }

  async attachSession(sessionId: string): Promise<void> {
    if (this.ids.includes(sessionId)) return
    const cwd = this.headerOf(sessionId)?.cwd
    // The real registry refuses a Session whose directory is not this Workspace's.
    if (cwd === undefined || !existsSync(cwd) || realpathSync(cwd) !== this.path) {
      throw new Error(`cwd of ${sessionId} does not resolve to ${this.path}`)
    }
    this.ids.unshift(sessionId)
  }
}

class FakeRegistry implements RegistryLike {
  workspaces: FakeWorkspace[] = []
  archivedSessionIds: string[] = []
  deleted: string[] = []
  private next = 1
  private readonly headerOf: (id: string) => HeaderLike | undefined

  constructor(headerOf: (id: string) => HeaderLike | undefined) {
    this.headerOf = headerOf
  }

  list(): FakeWorkspace[] {
    return [...this.workspaces]
  }

  async create(path: string, title?: string): Promise<FakeWorkspace> {
    const canonical = realpathSync(path)
    const existing = this.workspaces.find((workspace) => workspace.path === canonical)
    if (existing !== undefined) return existing
    const workspace = new FakeWorkspace(`ws-${this.next++}`, canonical, title, this.headerOf)
    this.workspaces.unshift(workspace)
    return workspace
  }

  async delete(id: string): Promise<boolean> {
    const before = this.workspaces.length
    this.workspaces = this.workspaces.filter((workspace) => workspace.id !== id)
    if (this.workspaces.length === before) return false
    this.deleted.push(id)
    return true
  }

  at(path: string): FakeWorkspace | undefined {
    return this.workspaces.find((workspace) => workspace.path === path)
  }
}

let base: string
let root: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "scratchpad-test-")))
  root = join(base, "scratchpad")
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const archived = (name: string) => join(root, ".archived", name)

function createHarness(options: Partial<ScratchpadOptions> = {}) {
  const headers = new Map<string, HeaderLike>()
  const live = new Set<string>()
  const busy = new Set<string>()
  const warnings: string[] = []
  const hooks: { onSleep?: () => void } = {}
  const registry = new FakeRegistry((id) => headers.get(id))
  let clock = 0
  let created = 0
  const pad = new Scratchpad({
    root,
    registerRoot: true,
    registry,
    headers: async () => [...headers.values()],
    liveHeader: (id) => (live.has(id) ? headers.get(id) : undefined),
    busy: async (id) => busy.has(id),
    fs: nodeFs,
    logger: { info: () => {}, warn: (message) => warnings.push(message) },
    sleep: async () => {
      clock += 1_000
      hooks.onSleep?.()
    },
    now: () => clock,
    settleTimeoutMs: 10_000,
    pollMs: 1_000,
    ...options,
  })

  /** A Session created in `cwd`, which the Host creates. Live unless told otherwise. */
  function session(id: string, cwd: string, extra: { origin?: "subagent"; live?: boolean } = {}) {
    mkdirSync(cwd, { recursive: true })
    headers.set(id, { id, cwd, createdAt: ++created, origin: extra.origin })
    if (extra.live !== false) live.add(id)
  }

  /** A registered scratch, as the plugin leaves it after creation. */
  async function scratch(name: string, ids: string[]) {
    const path = join(root, name)
    for (const id of ids) session(id, path, { live: false })
    const workspace = await registry.create(path, name)
    for (const id of ids) await workspace.attachSession(id)
    return { path, workspace }
  }

  function setArchived(ids: string[]) {
    registry.archivedSessionIds = ids
    pad.onArchiveSetChanged(ids)
  }

  const archive = (...ids: string[]) => setArchived([...registry.archivedSessionIds, ...ids])
  const unarchive = (...ids: string[]) =>
    setArchived(registry.archivedSessionIds.filter((id) => !ids.includes(id)))

  return { pad, registry, live, busy, warnings, hooks, session, scratch, archive, unarchive }
}

describe("creating a scratch", () => {
  it("registers the root and the scratch, titled after its directory, with the new Session", async () => {
    const h = createHarness()
    await h.pad.start()
    h.session("s1", join(root, "2026-11-05-231336"))
    h.pad.onSessionStarted("s1", "startup")
    await h.pad.idle()

    const scratch = h.registry.at(join(root, "2026-11-05-231336"))
    expect(scratch?.title).toBe("2026-11-05-231336")
    expect(scratch?.sessionIds).toEqual(["s1"])
    expect(h.registry.at(root)).toBeDefined()
    // The scratch is registered after the root, so it sits above it.
    expect(h.registry.workspaces[0]).toBe(scratch)
  })

  it("leaves the root unregistered when registerRoot is off", async () => {
    const h = createHarness({ registerRoot: false })
    await h.pad.start()
    h.session("s1", join(root, "a"))
    h.pad.onSessionStarted("s1", "startup")
    await h.pad.idle()

    expect(h.registry.workspaces.map((workspace) => workspace.path)).toEqual([join(root, "a")])
  })

  it("ignores the root, other directories, subagents, resumes and registered scratches", async () => {
    const h = createHarness()
    await h.scratch("existing", ["old"])
    await h.pad.start()
    h.session("in-root", root)
    h.session("elsewhere", join(base, "project"))
    h.session("child", join(root, "b"), { origin: "subagent" })
    h.session("resumed", join(root, "c"))
    h.session("sibling", join(root, "existing"))
    for (const id of ["in-root", "elsewhere", "child", "sibling"]) {
      h.pad.onSessionStarted(id, "startup")
    }
    h.pad.onSessionStarted("resumed", "resume")
    await h.pad.idle()

    expect(h.registry.workspaces.map((workspace) => workspace.path)).toEqual([
      join(root, "existing"),
    ])
    expect(h.registry.at(join(root, "existing"))?.sessionIds).toEqual(["old"])
  })

  it("does not register again a scratch whose Workspace the user deleted", async () => {
    const h = createHarness()
    const { workspace } = await h.scratch("kept", ["s1"])
    await h.registry.delete(workspace.id)
    await h.pad.start()
    h.session("fork", join(root, "kept"))
    h.pad.onSessionStarted("fork", "startup")
    await h.pad.idle()

    expect(h.registry.at(join(root, "kept"))).toBeUndefined()
  })

  it("defers Sessions that start before the index is loaded", async () => {
    const h = createHarness()
    h.session("s1", join(root, "early"))
    h.pad.onSessionStarted("s1", "startup")
    expect(h.registry.workspaces).toEqual([])
    await h.pad.start()
    await h.pad.idle()

    expect(h.registry.at(join(root, "early"))?.sessionIds).toEqual(["s1"])
  })
})

describe("archiving a scratch", () => {
  it("moves the directory to .archived and unregisters it once every Session is archived", async () => {
    const h = createHarness()
    const { path, workspace } = await h.scratch("a", ["s1", "s2"])
    writeFileSync(join(path, "notes.md"), "hi")
    await h.pad.start()

    h.archive("s1")
    await h.pad.idle()
    expect(existsSync(path)).toBe(true)

    h.archive("s2")
    await h.pad.idle()
    expect(existsSync(path)).toBe(false)
    expect(readdirSync(archived("a"))).toEqual(["notes.md"])
    expect(h.registry.deleted).toEqual([workspace.id])
  })

  it("waits for running work to stop first", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    await h.pad.start()
    h.busy.add("s1")
    let polls = 0
    h.hooks.onSleep = () => {
      polls++
      if (polls === 3) h.busy.delete("s1")
      expect(existsSync(path)).toBe(true)
    }
    h.archive("s1")
    await h.pad.idle()

    expect(polls).toBe(3)
    expect(existsSync(archived("a"))).toBe(true)
  })

  it("leaves the directory in place when the work never stops", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    await h.pad.start()
    h.busy.add("s1")
    h.archive("s1")
    await h.pad.idle()

    expect(existsSync(path)).toBe(true)
    expect(h.registry.at(path)).toBeDefined()
    expect(h.warnings).toEqual([expect.stringContaining("still running")])
  })

  it("does nothing when the archive is undone while it waits", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    await h.pad.start()
    h.busy.add("s1")
    h.hooks.onSleep = () => h.unarchive("s1")
    h.archive("s1")
    await h.pad.idle()

    expect(existsSync(path)).toBe(true)
    expect(h.registry.at(path)?.sessionIds).toEqual(["s1"])
    expect(h.registry.deleted).toEqual([])
  })

  it("keeps the scratch when the archive already holds that name", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    writeFileSync(join(path, "notes.md"), "hi")
    mkdirSync(archived("a"), { recursive: true })
    await h.pad.start()
    h.archive("s1")
    await h.pad.idle()

    expect(existsSync(path)).toBe(true)
    expect(h.warnings).toEqual([expect.stringContaining("already exists")])
  })

  it("ignores Sessions of the root and of unregistered directories", async () => {
    const h = createHarness()
    h.session("in-root", root, { live: false })
    h.session("loose", join(root, "loose"), { live: false })
    await h.pad.start()
    h.archive("in-root", "loose")
    await h.pad.idle()

    expect(existsSync(join(root, "loose"))).toBe(true)
    expect(existsSync(join(root, ".archived"))).toBe(false)
  })
})

describe("restoring a scratch", () => {
  async function archivedScratch(ids: string[]) {
    const h = createHarness()
    const { path } = await h.scratch("a", ids)
    writeFileSync(join(path, "notes.md"), "hi")
    await h.pad.start()
    h.archive(...ids)
    await h.pad.idle()
    expect(existsSync(path)).toBe(false)
    return { h, path }
  }

  it("moves the directory back before the unarchive returns, then registers it again", async () => {
    const { h, path } = await archivedScratch(["s1", "s2"])
    h.unarchive("s2")
    expect(readdirSync(path)).toEqual(["notes.md"])
    await h.pad.idle()

    // Newest first, the order a fresh registry bootstrap would give.
    expect(h.registry.at(path)?.sessionIds).toEqual(["s2", "s1"])
    expect(existsSync(archived("a"))).toBe(false)
  })

  it("brings the directory back for a fork made from an archived row", async () => {
    const { h, path } = await archivedScratch(["s1"])
    h.session("fork", path)
    // The Host never created the directory for the fork: drop the one the helper made.
    rmSync(path, { recursive: true })
    h.pad.onSessionStarted("fork", "startup")
    expect(readdirSync(path)).toEqual(["notes.md"])
    await h.pad.idle()

    expect(h.registry.at(path)?.sessionIds).toEqual(["fork", "s1"])
  })

  it("replaces an empty directory a new Session recreated", async () => {
    const { h, path } = await archivedScratch(["s1"])
    h.session("fork", path)
    h.pad.onSessionStarted("fork", "startup")
    expect(readdirSync(path)).toEqual(["notes.md"])
  })

  it("does not restore for a Session that is still archived", async () => {
    const { h, path } = await archivedScratch(["s1"])
    h.live.add("s1")
    h.pad.onSessionStarted("s1", "resume")
    expect(existsSync(path)).toBe(false)
  })

  it("refuses to overwrite a directory that has files", async () => {
    const { h, path } = await archivedScratch(["s1"])
    mkdirSync(path)
    writeFileSync(join(path, "other.txt"), "x")
    h.unarchive("s1")
    await h.pad.idle()

    expect(readdirSync(archived("a"))).toEqual(["notes.md"])
    expect(h.warnings).toEqual([expect.stringContaining("not empty")])
  })
})

describe("startup check", () => {
  it("archives scratches whose Sessions were all archived while the plugin was off", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    h.registry.archivedSessionIds = ["s1"]
    await h.pad.start()
    await h.pad.idle()

    expect(existsSync(path)).toBe(false)
    expect(existsSync(archived("a"))).toBe(true)
    expect(h.registry.at(path)).toBeUndefined()
  })

  it("restores scratches unarchived while the plugin was off", async () => {
    const h = createHarness()
    h.session("s1", join(root, "a"), { live: false })
    mkdirSync(join(root, ".archived"), { recursive: true })
    rmSync(join(root, "a"), { recursive: true })
    mkdirSync(archived("a"))
    await h.pad.start()
    await h.pad.idle()

    expect(existsSync(join(root, "a"))).toBe(true)
    expect(h.registry.at(join(root, "a"))?.sessionIds).toEqual(["s1"])
  })

  it("finishes an archive that stopped before unregistering the Workspace", async () => {
    const h = createHarness()
    const { path, workspace } = await h.scratch("a", ["s1"])
    mkdirSync(join(root, ".archived"))
    nodeFs.rename(path, archived("a"))
    h.registry.archivedSessionIds = ["s1"]
    await h.pad.start()
    await h.pad.idle()

    expect(h.registry.deleted).toEqual([workspace.id])
    expect(existsSync(archived("a"))).toBe(true)
  })

  it("leaves untouched scratches alone", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    await h.pad.start()
    await h.pad.idle()

    expect(existsSync(path)).toBe(true)
    expect(h.registry.at(path)?.sessionIds).toEqual(["s1"])
    expect(h.warnings).toEqual([])
  })
})

describe("dispose", () => {
  it("stops a waiting move", async () => {
    const h = createHarness()
    const { path } = await h.scratch("a", ["s1"])
    await h.pad.start()
    h.busy.add("s1")
    h.hooks.onSleep = () => h.pad.dispose()
    h.archive("s1")
    await h.pad.idle()

    expect(existsSync(path)).toBe(true)
  })
})
