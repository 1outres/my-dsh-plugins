import { ARCHIVE_DIR, joinPath, scratchNameOf } from "../shared/paths"
import type {
  FsOps,
  HeaderLike,
  LoggerLike,
  RegistryLike,
  SessionStartSource,
  WorkspaceLike,
} from "./types"

/** How long an archived scratch may keep running work before the move is given up. */
export const SETTLE_TIMEOUT_MS = 120_000

/** How often running work is checked while an archive move waits. */
export const POLL_MS = 2_000

export interface ScratchpadOptions {
  /** Absolute root as configured, with `~` expanded. */
  root: string
  /** Register the root as a Workspace when a scratch is created. */
  registerRoot: boolean
  registry: RegistryLike
  /** Every stored and live Session header. */
  headers(): Promise<readonly HeaderLike[]>
  /** A live Session's header. */
  liveHeader(sessionId: string): HeaderLike | undefined
  /** Whether the Session still runs anything: a turn, subagents, jobs, schedules or terminals. */
  busy(sessionId: string): Promise<boolean>
  fs: FsOps
  logger: LoggerLike
  sleep(ms: number, signal: AbortSignal): Promise<void>
  now(): number
  settleTimeoutMs?: number
  pollMs?: number
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Host-side scratch bookkeeping. A scratch is a directory directly under the
 * root, registered as its own Workspace. This class registers new scratches,
 * moves a scratch to `<root>/.archived` once every Session in it is archived,
 * and moves it back when one of them is unarchived or reopened.
 *
 * Operations on one scratch run one at a time. Moves are synchronous so that a
 * move started inside an event listener finishes before anything else runs.
 */
export class Scratchpad {
  private readonly options: ScratchpadOptions
  private readonly headers = new Map<string, HeaderLike>()
  /** Session id to scratch name, for top-level Sessions created in a scratch. */
  private readonly nameOf = new Map<string, string>()
  private archived = new Set<string>()
  private readonly chains = new Map<string, Promise<void>>()
  private readonly abort = new AbortController()
  private readonly early: [string, SessionStartSource][] = []
  private canonicalRoot: string | undefined
  private ready = false

  constructor(options: ScratchpadOptions) {
    this.options = options
  }

  /** Canonical root once it exists, otherwise the configured spelling. */
  rootPath(): string {
    if (this.canonicalRoot === undefined) {
      this.canonicalRoot = this.options.fs.realpath(this.options.root)
    }
    return this.canonicalRoot ?? this.options.root
  }

  /** Every spelling a Session cwd may use for the root. */
  roots(): string[] {
    const canonical = this.rootPath()
    return canonical === this.options.root ? [canonical] : [this.options.root, canonical]
  }

  /** Directory of a scratch while it is in use. */
  pathOf(name: string): string {
    return joinPath(this.rootPath(), name)
  }

  /** Directory of a scratch while it is archived. */
  archivePathOf(name: string): string {
    return joinPath(joinPath(this.rootPath(), ARCHIVE_DIR), name)
  }

  /** Index the existing Sessions, then catch up with changes made while the plugin was off. */
  async start(): Promise<void> {
    this.archived = new Set(this.options.registry.archivedSessionIds)
    await this.loadHeaders()
    this.ready = true
    for (const [sessionId, source] of this.early.splice(0)) this.onSessionStarted(sessionId, source)
    const names = new Set(this.nameOf.values())
    await Promise.all([...names].map((name) => this.enqueue(name, () => this.reconcile(name))))
  }

  /** Stop waiting moves. Directories are never left half-moved: each move is one rename. */
  dispose(): void {
    this.abort.abort()
  }

  /** Resolve once no operation is queued. */
  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.all([...this.chains.values()])
  }

  /**
   * An Agent started for a Session (`agent/created`). Registers a new scratch,
   * or moves an archived scratch back when a Session that is not archived needs
   * it, such as a fork made from an archived row.
   */
  onSessionStarted(sessionId: string, source: SessionStartSource): void {
    const header = this.options.liveHeader(sessionId)
    if (header === undefined) return
    this.remember(header)
    if (!this.ready) {
      this.early.push([sessionId, source])
      return
    }
    const name = this.nameOf.get(sessionId)
    if (name === undefined || this.archived.has(sessionId)) return
    const { fs } = this.options
    const path = this.pathOf(name)
    const shared = this.members(name).some((member) => member.id !== sessionId)
    if (
      shared &&
      fs.exists(this.archivePathOf(name)) &&
      (!fs.exists(path) || fs.isEmptyDir(path))
    ) {
      if (this.restoreDirectory(name)) void this.enqueue(name, () => this.register(name))
      return
    }
    if (
      source === "startup" &&
      !shared &&
      fs.exists(path) &&
      this.workspaceFor(name) === undefined
    ) {
      void this.enqueue(name, () => this.registerNew(name, sessionId))
    }
  }

  /**
   * The registry's archive set changed (`domain/changed`). Unarchived scratches
   * move back before this returns; archived ones move once their work stops.
   */
  onArchiveSetChanged(next: readonly string[]): void {
    const previous = this.archived
    this.archived = new Set(next)
    if (!this.ready) return
    for (const id of previous) {
      if (this.archived.has(id)) continue
      const name = this.nameOf.get(id)
      if (name === undefined || !this.options.fs.exists(this.archivePathOf(name))) continue
      if (this.restoreDirectory(name)) void this.enqueue(name, () => this.register(name))
    }
    const archivedNames = new Set<string>()
    for (const id of this.archived) {
      if (previous.has(id)) continue
      const name = this.nameOf.get(id)
      if (name !== undefined) archivedNames.add(name)
    }
    for (const name of archivedNames) void this.enqueue(name, () => this.archiveWhenSettled(name))
  }

  private remember(header: HeaderLike): void {
    this.headers.set(header.id, header)
    if (header.origin === "subagent") return
    const name = scratchNameOf(header.cwd, this.roots())
    if (name !== undefined) this.nameOf.set(header.id, name)
  }

  private async loadHeaders(): Promise<void> {
    for (const header of await this.options.headers()) this.remember(header)
  }

  /** Top-level Sessions created in a scratch, oldest first. */
  private members(name: string): HeaderLike[] {
    const members: HeaderLike[] = []
    for (const [id, scratch] of this.nameOf) {
      const header = this.headers.get(id)
      if (scratch === name && header !== undefined) members.push(header)
    }
    return members.sort((left, right) => left.createdAt - right.createdAt)
  }

  private workspaceFor(name: string): WorkspaceLike | undefined {
    const path = this.pathOf(name)
    return this.options.registry.list().find((workspace) => workspace.path === path)
  }

  private allArchived(workspace: WorkspaceLike): boolean {
    const ids = workspace.sessionIds
    return ids.length > 0 && ids.every((id) => this.archived.has(id))
  }

  private enqueue(name: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(name) ?? Promise.resolve()
    const next = previous
      .then(() => (this.abort.signal.aborted ? undefined : operation()))
      .catch((error: unknown) => {
        this.options.logger.warn(`scratchpad: ${name}: ${describe(error)}`)
      })
    this.chains.set(name, next)
    void next.then(() => {
      if (this.chains.get(name) === next) this.chains.delete(name)
    })
    return next
  }

  /** Move an archived scratch back to the root. Synchronous. */
  private restoreDirectory(name: string): boolean {
    const { fs, logger } = this.options
    const from = this.archivePathOf(name)
    const to = this.pathOf(name)
    try {
      if (fs.exists(to)) {
        if (!fs.isEmptyDir(to)) {
          logger.warn(`scratchpad: ${name} stays archived: ${to} already exists and is not empty`)
          return false
        }
        // A Session started without the directory and recreated it empty.
        fs.removeEmptyDir(to)
      }
      fs.rename(from, to)
    } catch (error) {
      logger.warn(`scratchpad: could not restore ${name}: ${describe(error)}`)
      return false
    }
    logger.info(`scratchpad: restored ${name} from the archive`)
    return true
  }

  /** Register a restored scratch and give it back its Sessions, newest first. */
  private async register(name: string): Promise<void> {
    const path = this.pathOf(name)
    if (!this.options.fs.exists(path)) return
    await this.loadHeaders()
    const workspace = this.workspaceFor(name) ?? (await this.options.registry.create(path, name))
    // attachSession prepends, so attaching oldest first leaves the newest on top.
    for (const member of this.members(name)) {
      if (workspace.sessionIds.includes(member.id)) continue
      try {
        await workspace.attachSession(member.id)
      } catch (error) {
        this.options.logger.warn(
          `scratchpad: could not attach ${member.id} to ${name}: ${describe(error)}`,
        )
      }
    }
  }

  /** Register a scratch that a new Session was just created in. */
  private async registerNew(name: string, sessionId: string): Promise<void> {
    const { registry, registerRoot } = this.options
    const root = this.rootPath()
    if (registerRoot && !registry.list().some((workspace) => workspace.path === root)) {
      await registry.create(root)
    }
    const workspace = this.workspaceFor(name) ?? (await registry.create(this.pathOf(name), name))
    if (!workspace.sessionIds.includes(sessionId)) await workspace.attachSession(sessionId)
  }

  /** Move a registered scratch to the archive once all its Sessions are archived and idle. */
  private async archiveWhenSettled(name: string): Promise<void> {
    const { fs, logger, registry } = this.options
    const workspace = this.workspaceFor(name)
    if (workspace === undefined || !this.allArchived(workspace)) return
    const path = this.pathOf(name)
    const target = this.archivePathOf(name)
    if (!fs.exists(path)) {
      // Moved by an earlier run that stopped before unregistering it.
      if (fs.exists(target)) await registry.delete(workspace.id)
      return
    }
    if (!(await this.settle(name, workspace))) return
    // No await between this check and the rename: an unarchive cannot slip in.
    const current = this.workspaceFor(name)
    if (current === undefined || !this.allArchived(current)) return
    if (fs.exists(target)) {
      logger.warn(`scratchpad: ${name} stays in place: ${target} already exists`)
      return
    }
    try {
      fs.ensureDir(joinPath(this.rootPath(), ARCHIVE_DIR))
      fs.rename(path, target)
    } catch (error) {
      logger.warn(`scratchpad: could not archive ${name}: ${describe(error)}`)
      return
    }
    logger.info(`scratchpad: archived ${name} to ${target}`)
    await registry.delete(current.id)
  }

  /** Wait until no Session of the scratch runs anything. */
  private async settle(name: string, workspace: WorkspaceLike): Promise<boolean> {
    const { now, sleep, busy, logger } = this.options
    const deadline = now() + (this.options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS)
    const poll = this.options.pollMs ?? POLL_MS
    for (;;) {
      if (this.abort.signal.aborted || !this.allArchived(workspace)) return false
      let running = false
      for (const id of workspace.sessionIds) {
        try {
          running = await busy(id)
        } catch {
          running = true
        }
        if (running) break
      }
      if (!running) return true
      if (now() >= deadline) {
        logger.warn(`scratchpad: ${name} stays in place: its sessions are still running`)
        return false
      }
      try {
        await sleep(poll, this.abort.signal)
      } catch {
        return false
      }
    }
  }

  /** Catch up one scratch at startup. */
  private async reconcile(name: string): Promise<void> {
    const members = this.members(name)
    if (members.length === 0) return
    if (members.every((member) => this.archived.has(member.id))) {
      await this.archiveWhenSettled(name)
      return
    }
    const { fs } = this.options
    const path = this.pathOf(name)
    if (fs.exists(this.archivePathOf(name)) && (!fs.exists(path) || fs.isEmptyDir(path))) {
      if (this.restoreDirectory(name)) await this.register(name)
    }
  }
}
