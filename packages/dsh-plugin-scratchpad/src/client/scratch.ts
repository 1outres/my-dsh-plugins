import { joinPath, scratchName, scratchNameOf, uniqueName } from "../shared/paths"
import type {
  Observable,
  SessionListState,
  Translate,
  WorkspaceSnapshot,
  WorkspaceView,
} from "./types"

/** How long to wait for the Host half to register a new scratch before opening its Session directly. */
export const REGISTER_TIMEOUT_MS = 15_000

/** How long a failure stays on the button. */
export const ERROR_HOLD_MS = 6_000

/** The scratch root cannot be resolved: a relative path, or `~` before the Host is connected. */
export class ScratchRootError extends Error {
  constructor() {
    super("scratch root unavailable")
    this.name = "ScratchRootError"
  }
}

export interface ScratchDeps {
  /** Absolute scratch root, or undefined when it cannot be resolved yet. */
  root(): string | undefined
  workspaces(): WorkspaceSnapshot
  sessions(): SessionListState
  createSession(cwd: string): Promise<string>
  openWorkspace(workspaceId: string): Promise<void>
  openSession(sessionId: string): void
  /** Resolve the Workspace a Session joins, or undefined after `timeoutMs`. */
  waitForWorkspace(sessionId: string, timeoutMs: number): Promise<string | undefined>
  now(): Date
}

/** Scratch Workspaces under the root, newest first. */
export function scratchWorkspaces(
  snapshot: WorkspaceSnapshot,
  roots: readonly string[],
): WorkspaceView[] {
  return snapshot.items
    .filter((workspace) => scratchNameOf(workspace.path, roots) !== undefined)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

/**
 * The newest scratch when nothing was ever sent in it and none of its
 * Sessions is archived; opening it again avoids piling up empty scratches.
 */
export function reusableScratch(
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
  roots: readonly string[],
): WorkspaceView | undefined {
  const [latest] = scratchWorkspaces(workspaces, roots)
  if (latest === undefined) return undefined
  const archived = new Set(workspaces.archivedSessionIds)
  const unused = latest.sessionIds.every(
    (id) => !archived.has(id) && sessions.byId[id]?.blank === true,
  )
  return unused ? latest : undefined
}

/**
 * Whether a scratch name is in use: by a registered Workspace, or by any
 * Session created there. Archived scratches keep their Sessions, so their
 * names stay taken while the directory sits in the archive.
 */
export function nameTaken(
  name: string,
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
  roots: readonly string[],
): boolean {
  if (workspaces.items.some((workspace) => scratchNameOf(workspace.path, roots) === name)) {
    return true
  }
  return Object.values(sessions.byId).some((row) => scratchNameOf(row?.cwd, roots) === name)
}

/**
 * Open a scratch: the newest one when it is still unused, otherwise a new
 * empty directory. The Host creates the directory with the Session; the Host
 * half registers it as a Workspace, which is then opened like any other.
 */
export async function startScratch(deps: ScratchDeps): Promise<void> {
  const root = deps.root()
  if (root === undefined) throw new ScratchRootError()
  const roots = [root]
  const reusable = reusableScratch(deps.workspaces(), deps.sessions(), roots)
  if (reusable !== undefined) {
    await deps.openWorkspace(reusable.workspaceId)
    return
  }
  const name = uniqueName(scratchName(deps.now()), (candidate) =>
    nameTaken(candidate, deps.workspaces(), deps.sessions(), roots),
  )
  const sessionId = await deps.createSession(joinPath(root, name))
  const workspaceId = await deps.waitForWorkspace(sessionId, REGISTER_TIMEOUT_MS)
  if (workspaceId === undefined) deps.openSession(sessionId)
  else await deps.openWorkspace(workspaceId)
}

export interface ScratchStatus {
  readonly busy: boolean
  readonly error: string | undefined
}

export interface ScratchStarter {
  /** Start a scratch; a second call while one is starting joins it. */
  start(): Promise<void>
  readonly status: Observable<ScratchStatus>
  dispose(): void
}

/** Wrap {@link startScratch} with a busy flag and a transient error for the buttons. */
export function createScratchStarter(
  deps: ScratchDeps,
  options: { t: Translate; warn(message: string, error: unknown): void },
): ScratchStarter {
  let status: ScratchStatus = { busy: false, error: undefined }
  let running: Promise<void> | undefined
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: ScratchStatus) => {
    status = next
    for (const listener of [...listeners]) listener()
  }
  const message = (error: unknown) =>
    error instanceof ScratchRootError
      ? options.t("error.root")
      : options.t("error.create", {
          detail: error instanceof Error ? error.message : String(error),
        })

  return {
    start() {
      if (running !== undefined) return running
      if (clearTimer !== undefined) clearTimeout(clearTimer)
      publish({ busy: true, error: undefined })
      running = startScratch(deps).then(
        () => {
          running = undefined
          publish({ busy: false, error: undefined })
        },
        (error: unknown) => {
          running = undefined
          options.warn("scratchpad: could not start a scratch", error)
          publish({ busy: false, error: message(error) })
          clearTimer = setTimeout(() => publish({ busy: false, error: undefined }), ERROR_HOLD_MS)
        },
      )
      return running
    },
    status: {
      getSnapshot: () => status,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    dispose() {
      if (clearTimer !== undefined) clearTimeout(clearTimer)
      listeners.clear()
    },
  }
}

/** Resolve the Workspace a Session joins, watching the Workspace list. */
export function waitForWorkspace(
  list: Observable<WorkspaceSnapshot>,
  sessionId: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const find = () =>
    list.getSnapshot().items.find((workspace) => workspace.sessionIds.includes(sessionId))
      ?.workspaceId
  const found = find()
  if (found !== undefined) return Promise.resolve(found)
  return new Promise((resolve) => {
    let done = false
    let unsubscribe: (() => void) | undefined
    const finish = (value: string | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      unsubscribe?.()
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    unsubscribe = list.subscribe(() => {
      const workspaceId = find()
      if (workspaceId !== undefined) finish(workspaceId)
    })
    if (done) unsubscribe()
  })
}
