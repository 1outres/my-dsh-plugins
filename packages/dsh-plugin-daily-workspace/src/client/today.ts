import { dayFolderOf } from "../shared/paths"
import type { Observable, Translate, WorkspaceSnapshot, WorkspaceView } from "./types"

/** How long a failure stays on the button. */
export const ERROR_HOLD_MS = 6_000

/** The root cannot be resolved: a relative path, or `~` before the Host is connected. */
export class TodayRootError extends Error {
  constructor() {
    super("daily-workspace root unavailable")
    this.name = "TodayRootError"
  }
}

/** No day folder is registered under the root yet. */
export class TodayFolderError extends Error {
  constructor() {
    super("today's folder is not registered")
    this.name = "TodayFolderError"
  }
}

/**
 * The newest registered day folder under `root`.
 * @param snapshot - registered Workspaces.
 * @param root - absolute root that holds the year folders.
 * @returns the newest day-folder Workspace, or undefined when there is none.
 */
export function newestDayWorkspace(
  snapshot: WorkspaceSnapshot,
  root: string,
): WorkspaceView | undefined {
  let newest: { workspace: WorkspaceView; key: string } | undefined
  for (const workspace of snapshot.items) {
    const folder = dayFolderOf(workspace.path, root)
    if (folder === undefined) continue
    const key = `${folder.year}${folder.month}${folder.day}`
    if (newest === undefined || key > newest.key) newest = { workspace, key }
  }
  return newest?.workspace
}

export interface TodayDeps {
  /** Absolute root, or undefined when it cannot be resolved yet. */
  root(): string | undefined
  workspaces(): WorkspaceSnapshot
  openWorkspace(workspaceId: string): Promise<void>
}

/**
 * Open the newest registered day folder. The browser never computes the date
 * and never creates anything: the Host half owns both.
 */
export async function openToday(deps: TodayDeps): Promise<void> {
  const root = deps.root()
  if (root === undefined) throw new TodayRootError()
  const workspace = newestDayWorkspace(deps.workspaces(), root)
  if (workspace === undefined) throw new TodayFolderError()
  await deps.openWorkspace(workspace.workspaceId)
}

export interface TodayStatus {
  readonly busy: boolean
  readonly error: string | undefined
}

export interface TodayOpener {
  /** Open today's folder; a second call while one is opening joins it. */
  open(): Promise<void>
  readonly status: Observable<TodayStatus>
  dispose(): void
}

/** Wrap {@link openToday} with a busy flag and a transient error for the button. */
export function createTodayOpener(
  deps: TodayDeps,
  options: { t: Translate; warn(message: string, error: unknown): void },
): TodayOpener {
  let status: TodayStatus = { busy: false, error: undefined }
  let running: Promise<void> | undefined
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: TodayStatus) => {
    status = next
    for (const listener of [...listeners]) listener()
  }
  const message = (error: unknown) => {
    if (error instanceof TodayRootError) return options.t("error.root")
    if (error instanceof TodayFolderError) return options.t("error.missing")
    return options.t("error.open", {
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return {
    open() {
      if (running !== undefined) return running
      if (clearTimer !== undefined) clearTimeout(clearTimer)
      publish({ busy: true, error: undefined })
      running = openToday(deps).then(
        () => {
          running = undefined
          publish({ busy: false, error: undefined })
        },
        (error: unknown) => {
          running = undefined
          options.warn("daily-workspace: could not open today", error)
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
