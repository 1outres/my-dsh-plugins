/**
 * Contract between the mode-memory Host half and the DSH services it uses.
 *
 * Every DSH service is reached through one of these narrow ports, so the
 * memory logic can be tested without a running Harness and a DSH upgrade only
 * touches the adapters in `index.ts`.
 */

/** Absolute project directory: a Workspace path, which is also its Sessions' `cwd`. */
export type ProjectPath = string

/** Agent preset id, such as `standard`, `cordis`, or `ptc`. */
export type PresetId = string

/** `session.create` Remote request (`@deepseek-ai/dsh-api-session-controller`). */
export interface SessionCreateRequest {
  readonly sessionId?: string
  readonly workspaceId?: string
  readonly cwd?: string
  readonly agentPreset?: PresetId
}

/** `session.create` Remote result. */
export interface SessionCreateValue {
  readonly sessionId: string
  readonly agentPreset?: PresetId
}

/** One remembered choice, as stored. */
export interface RememberedMode {
  readonly agentPreset: PresetId
  /** Epoch milliseconds of the choice. */
  readonly updatedAt: number
}

/** Durable per-project memory of the last chosen preset. */
export interface ModeMemoryStore {
  get(project: ProjectPath): RememberedMode | undefined
  remember(project: ProjectPath, agentPreset: PresetId): Promise<void>
  forget(project: ProjectPath): Promise<void>
}

/** The subset of a storage-domain table the store writes through. */
export interface MemoryTable {
  get(key: ProjectPath): RememberedMode | undefined
  put(key: ProjectPath, value: RememberedMode): Promise<void>
  delete(key: ProjectPath): Promise<boolean>
}

/** One entry of the preset roster (`agentPresets.list()`). */
export interface PresetRosterEntry {
  readonly id: PresetId
  /** Why the preset cannot compose a Session; absent when it can. */
  readonly broken?: string
}

export interface PresetRosterPort {
  list(): Promise<readonly PresetRosterEntry[]>
}

export interface WorkspacesPort {
  /** Path of a registered Workspace, or undefined when the id is unknown. */
  pathOf(workspaceId: string): ProjectPath | undefined
}

/** The header facts of a live Session that decide whether a selection is remembered. */
export interface SessionFacts {
  readonly cwd?: string
  readonly origin?: "subagent"
}

export interface SessionsPort {
  /** Facts of a live Session, or undefined when it is not live. */
  factsOf(sessionId: string): SessionFacts | undefined
}

export interface LoggerPort {
  info(message: string): void
  warn(message: string): void
}

/** Clock in epoch milliseconds. */
export type Clock = () => number

/** Marks work that runs inside one intercepted session.create call. */
export interface CreateScope {
  run<T>(operation: () => T): T
  active(): boolean
}

/** The `create` method the hook wraps. */
export type CreateSession = (request: SessionCreateRequest) => Promise<SessionCreateValue>

/** Decides the preset of a created Session and records explicit choices around `session.create`. */
export interface CreateInterceptor {
  /**
   * Run one `session.create` call through the memory.
   * @param request - the request the Client sent.
   * @param create - the original Host implementation.
   * @returns the original result.
   */
  intercept(request: SessionCreateRequest, create: CreateSession): Promise<SessionCreateValue>
}
