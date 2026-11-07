/** Contracts shared by the host and the browser half. */

export type TransportId = "ssh"

export type TargetKind = "linux" | "network"

/** One registered connection target. Secret values never appear here. */
export interface RemoteTarget {
  name: string
  transport: TransportId
  kind: TargetKind
  host: string
  user?: string
  port?: number
  jump?: string
  sshOptions: string[]
  /** Names of the secret fields the user fills. */
  secrets: string[]
  promptPattern?: string
  initCommands: string[]
}

/** What `remote_target_list` reports for one target. */
export interface RemoteTargetStatus {
  target: RemoteTarget
  connected: boolean
  sessions: RemoteSessionStatus[]
  secretFields: Array<{ name: string; present: boolean }>
}

export interface RemoteSessionStatus {
  id: string
  target: string
  name?: string
  state: "open" | "exited"
  /** Exit code once the remote shell closed. */
  exitCode?: number
}

export interface ExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Whether output was cut to the configured byte limit. */
  truncated: boolean
}

export interface ReadResult {
  path: string
  offset: number
  totalLines: number
  lines: Array<{ number: number; text: string }>
  /** Whether more lines exist past the returned window. */
  truncated: boolean
}

export interface WriteResult {
  path: string
  /** Whether the path existed before the write. */
  existed: boolean
}

export interface EditResult {
  path: string
  replacements: number
}

export interface SessionOpenResult {
  session: RemoteSessionStatus
  output: string
  /** Why the opening output ended. */
  reason: SessionBoundary
  /** True when a session with the same target and name was already open. */
  reused: boolean
}

export type SessionBoundary = "prompt" | "idle" | "timeout" | "exited"

export interface SessionSendResult {
  sessionId: string
  output: string
  reason: SessionBoundary
  state: "open" | "exited"
  exitCode?: number
}

export interface SessionReadResult {
  sessionId: string
  offset: number
  count: number
  totalLines: number
  lines: string[]
}

/** A prompt the host puts on the tool call card. It never carries secret values. */
export interface RemotePromptRequest {
  id: string
  sessionId: string
  callId: string
  kind: "register" | "secret" | "hostkey"
  title: string
  detail?: string
  target?: RemoteTarget
  hostKey?: RemoteHostKey
  fields: RemotePromptField[]
  /** True when a previous value was rejected, so the card warns before asking again. */
  retry?: boolean
}

export interface RemotePromptField {
  name: string
  label: string
  masked: boolean
}

export interface RemoteHostKey {
  host: string
  algorithm: string
  fingerprint: string
}

export interface RemotePromptAnswer {
  decision: "approve" | "reject" | "submit"
  values?: Record<string, string>
  reason?: string
}

/** Items carried by the prompt stream the browser subscribes to. */
export type RemotePromptEvent =
  | { type: "prompt"; prompt: RemotePromptRequest }
  | { type: "close"; id: string }

/** Durable card payload recorded in a tool result's `meta`. */
export type RemoteTargetMeta =
  | { kind: "remote/target-added"; target: RemoteTarget }
  | { kind: "remote/target-removed"; name: string }

/** Durable, client-visible target list folded from tool results. */
export interface RemoteTargetsView {
  targets: RemoteTarget[]
}
