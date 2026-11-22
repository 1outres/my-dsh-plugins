/**
 * Contract between the restart Host half and the DeepSeek Harness services it uses.
 *
 * Every DSH service is reached through one of these narrow ports, so the restart
 * logic can be tested without a running Harness and a DSH upgrade only touches
 * the adapters in `index.ts`.
 */

/** Agent preset id, such as `standard`, `cordis`, or `creator-ptc`. */
export type PresetId = string

/** Lifecycle state of one live agent. */
export type AgentStatus = "idle" | "running"

/** One live agent, as the restart logic sees it. */
export interface AgentPort {
  readonly id: string
  /** Session that this agent drives. */
  readonly sessionId: string
  /** Session title, when the title service has one. */
  readonly title?: string
  status(): AgentStatus
  /** Resolves when this agent has no active turn left. */
  whenIdle(): Promise<void>
  /** Deliver one follow-up user message; the adapter sets its source. */
  followup(text: string): void
}

/** Every live agent of the Harness. */
export interface AgentsPort {
  list(): readonly AgentPort[]
}

/** Asks the Harness launcher for a bounded process exit. */
export interface LauncherPort {
  exit(code: number): void
}

/** Ends the process when the natural shutdown does not finish. */
export interface WatchdogPort {
  arm(): void
}

export interface LoggerPort {
  info(message: string): void
  warn(message: string): void
}

/** Clock in epoch milliseconds. */
export type Clock = () => number

/** One stored resume request: the session, its note, and when it was made. */
export interface ResumeRecord {
  readonly sessionId: string
  readonly note?: string
  readonly requestedAt: number
}

/** Durable record of the restart that is about to happen. */
export interface ResumeStore {
  read(): ResumeRecord | undefined
  save(record: ResumeRecord): Promise<void>
  clear(): Promise<boolean>
}

/** The subset of a storage-domain table the store writes through. */
export interface ResumeTable {
  get(key: string): ResumeRecord | undefined
  put(key: string, value: ResumeRecord): Promise<void>
  delete(key: string): Promise<boolean>
}

/** A live session that a resume message can reach. */
export interface ResumeDelivery {
  followup(text: string): void
}

/** Result of looking up the session that asked for the restart. */
export type ResolvedSession =
  | { readonly kind: "found"; readonly deliver: ResumeDelivery }
  | { readonly kind: "missing"; readonly reason: string }

/** Resolves a stored session id to a live session after the restart. */
export interface ResumeSessionPort {
  resolve(sessionId: string): Promise<ResolvedSession>
}
