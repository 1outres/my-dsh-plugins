/**
 * Contract between the daily-workspace Host half and the DSH services it uses.
 *
 * The Workspace registry, the filesystem, the clock, timers, and the log are
 * reached through these narrow ports, so the logic runs in tests without a
 * Harness and a DSH upgrade only touches the adapters in `index.ts` and
 * `host/fs.ts`.
 */

/** One registered Workspace (`@deepseek-ai/dsh-workspace`). */
export interface RegisteredWorkspace {
  readonly id: string
  /** Canonical directory path. */
  readonly path: string
}

/** `ctx.workspaceRegistry`: the only Host service this plugin reads. */
export interface WorkspaceRegistryPort {
  /** Registered Workspaces in durable order. */
  list(): readonly RegisteredWorkspace[]
  /**
   * Register an existing directory with the directory name as its title.
   * A repeated call for the same canonical path returns the existing
   * Workspace and leaves its title alone.
   */
  create(path: string): Promise<RegisteredWorkspace>
}

/** The filesystem calls the daily folders need. */
export interface FsPort {
  /** Create a directory and its parents. Returns whether it created anything. */
  ensureDir(path: string): Promise<boolean>
  /** Canonical path; rejects when the path does not exist. */
  realpath(path: string): Promise<string>
}

/** The Host clock, read in the Host's local time zone. */
export interface ClockPort {
  now(): Date
}

/** Long-delay timers. At most one timer is alive at a time. */
export interface TimerPort {
  /** Run `callback` after `delayMs`. Returns a function that cancels the timer. */
  set(delayMs: number, callback: () => void): () => void
}

export interface LoggerPort {
  info(message: string): void
  warn(message: string): void
}

/** Folders of one local day, from the root down; all are absolute paths. */
export interface DailyPaths {
  /** `<root>/YYYY` */
  readonly year: string
  /** `<root>/YYYY/MM` */
  readonly month: string
  /** `<root>/YYYY/MM/DD` */
  readonly day: string
}
