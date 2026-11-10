/** Contracts shared by the host and the browser half. */

export type TransportId = "ssh" | "serial"

export type TargetKind = "linux" | "network"

/** Fields every target has, whatever its transport. */
interface TargetBase {
  name: string
  kind: TargetKind
  /** Names of the secret fields the user fills. */
  secrets: string[]
  promptPattern?: string
  initCommands: string[]
}

/** A host reached with the OpenSSH client on the Harness Host. */
export interface SshTarget extends TargetBase {
  transport: "ssh"
  host: string
  user?: string
  port?: number
  jump?: string
  sshOptions: string[]
}

export type SerialParity = "none" | "even" | "odd"

export type SerialFlowControl = "none" | "rtscts" | "xonxoff"

/** The line settings of one serial port. */
export interface SerialSettings {
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  parity: SerialParity
  stopBits: 1 | 2
  flowControl: SerialFlowControl
}

/** The bytes one Enter key sends on a serial console. */
export type SerialLineEnding = "cr" | "lf" | "crlf"

/** A serial port on a client PC, reached through its dsh-serial-agent. */
export interface SerialTarget extends TargetBase {
  transport: "serial"
  /** Agent name from the `serialAgents` config. */
  agent: string
  /** Fingerprint of the agent key the user approved, `SHA256:<base64>`. */
  agentFingerprint: string
  /** Device path on the agent machine, such as /dev/ttyUSB0. */
  device: string
  serial: SerialSettings
  lineEnding: SerialLineEnding
}

/** One registered connection target. Secret values never appear here. */
export type RemoteTarget = SshTarget | SerialTarget

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

/** One serial port an agent offers. */
export interface SerialPortInfo {
  path: string
  description?: string
  usb?: SerialUsbInfo
  /** Whether the agent holds the port open now. */
  open: boolean
  /** Settings of the open port. */
  settings?: SerialSettings
  /** The target of this session that uses the port, when one does. */
  usedBy?: string
  /** True when another Harness session holds the port. */
  usedElsewhere: boolean
}

export interface SerialUsbInfo {
  vendorId: string
  productId: string
  serialNumber?: string
  manufacturer?: string
  product?: string
}

/** What `remote_serial_agents` reports for one authorized agent. */
export interface SerialAgentStatus {
  name: string
  fingerprint: string
  online: boolean
  /** Facts the agent reported when it connected. */
  info?: SerialAgentInfo
  ports: SerialPortInfo[]
}

export interface SerialAgentInfo {
  version: string
  hostname: string
  os: string
  arch: string
}

export interface SessionBreakResult {
  sessionId: string
  durationMs: number
}

/** Durable card payload recorded in a tool result's `meta`. */
export type RemoteTargetMeta =
  | { kind: "remote/target-added"; target: RemoteTarget }
  | { kind: "remote/target-removed"; name: string }

/** Durable, client-visible target list folded from tool results. */
export interface RemoteTargetsView {
  targets: RemoteTarget[]
}
