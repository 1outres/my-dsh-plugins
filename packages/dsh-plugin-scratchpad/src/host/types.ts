/**
 * The slices of the Host services this plugin uses. The plugin depends on these
 * shapes instead of importing the owning DSH packages.
 */

/** A registered Workspace (`@deepseek-ai/dsh-workspace`). */
export interface WorkspaceLike {
  readonly id: string
  /** Canonical directory path. */
  readonly path: string
  /** Sessions accounted to the Workspace, in display order. */
  readonly sessionIds: readonly string[]
  attachSession(sessionId: string): Promise<void>
}

/** `ctx.workspaceRegistry`. */
export interface RegistryLike {
  list(): WorkspaceLike[]
  create(path: string, title?: string): Promise<WorkspaceLike>
  delete(id: string): Promise<boolean>
  /** The registry-global archive set. */
  readonly archivedSessionIds: readonly string[]
}

/** The part of a Session header the plugin reads (`@deepseek-ai/dsh-session`). */
export interface HeaderLike {
  readonly id: string
  /** Creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Directory the Session was created in; it never changes. */
  readonly cwd?: string
  readonly origin?: "subagent"
}

export interface LoggerLike {
  info(message: string): void
  warn(message: string): void
}

/** How a Session's Agent started (`agent/created` payload). */
export type SessionStartSource = "startup" | "resume" | "clear" | "compact"

/** Synchronous filesystem operations. Moves must finish inside one event listener. */
export interface FsOps {
  exists(path: string): boolean
  /** Whether `path` is a directory with no entries. */
  isEmptyDir(path: string): boolean
  /** Rename on the same filesystem; never copies. */
  rename(from: string, to: string): void
  /** Remove an empty directory; fails on a non-empty one. */
  removeEmptyDir(path: string): void
  /** Create a directory and its parents. */
  ensureDir(path: string): void
  /** Canonical path, or undefined when `path` does not exist. */
  realpath(path: string): string | undefined
  /** Names of the subdirectories of `path`; empty when it does not exist. */
  listDirs(path: string): string[]
}
