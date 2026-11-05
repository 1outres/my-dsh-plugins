/**
 * Shapes shared between the modules of this plugin. Each module owns its own
 * logic and depends on the others only through these types.
 */
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess"

export const PROVIDER_ID = "claude-subscription"
export const MCP_SERVER_NAME = "dsh"
/** The CLI shows every tool of the inert MCP server to the model under this prefix. */
export const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`

export type JsonObject = Record<string, unknown>
export type Env = Readonly<Record<string, string | undefined>>

/** One Anthropic Messages content block. The wire format owns its other fields. */
export interface NativeBlock extends JsonObject {
  type: string
}

export interface NativeUserFrame {
  type: "user"
  message: { role: "user"; content: NativeBlock[] }
  /** Set by the process runner on replayed turns. Only the last frame queries the model. */
  shouldQuery?: false
}

export interface NativeAssistantFrame {
  type: "assistant"
  message: JsonObject & { role: "assistant"; content: NativeBlock[] }
}

/** One line written to `claude -p --input-format stream-json`. */
export type NativeFrame = NativeUserFrame | NativeAssistantFrame

/** One tool as the inert MCP server lists it to the CLI. */
export interface ToolManifestEntry {
  name: string
  description: string
  inputSchema: JsonObject
}

/** A DSH model call, translated and ready to run. It holds no process or network state. */
export interface PreparedRequest {
  /** Value for `--model`, for example `claude-opus-5-5[1m]`. */
  nativeModel: string
  /** Text for `--system-prompt-file`. */
  system: string
  frames: readonly NativeFrame[]
  /** Value for `CLAUDE_CODE_EXTRA_BODY`: generation fields and the tool list. */
  extraBody: JsonObject
  /** Value for `--effort`, when the request sets one. */
  effort?: string
  /** Value for `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, when the request sets one. */
  maxOutputTokens?: number
  manifest: readonly ToolManifestEntry[]
  /** DSH tool name to the name inside the `mcp__dsh__` prefix. Differs only for long names. */
  toolNames: ReadonlyMap<string, string>
  /** Value for `--session-id`. Stays the same for every call of one conversation. */
  sessionId: string
  /** A title or compaction call with no tools and one frame. It is never replayed. */
  oneShot: boolean
}

export interface NativeUsage extends JsonObject {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens_details?: { thinking_tokens?: number }
}

/** The assistant message the relay assembled from the upstream stream. */
export interface CapturedMessage extends JsonObject {
  id?: string
  role: "assistant"
  content: NativeBlock[]
  stop_reason?: string
  stop_details?: JsonObject
  usage: NativeUsage
}

/** Parses the upstream SSE stream as it passes through the relay. */
export interface StreamCapture {
  readonly message: CapturedMessage | null
  readonly complete: boolean
  /** The first `error` event of the stream, which the API sends instead of closing it cleanly. */
  readonly error: { type: string; message: string } | null
  feed(chunk: Uint8Array): void
}

export interface RelayOptions {
  /** Upstream base URL. HTTPS, or loopback HTTP for test fixtures. */
  upstream: string
  /** Socket timeout in milliseconds. */
  timeoutMs: number
  /** Content of the last frame the CLI was asked to query. */
  queried: readonly NativeBlock[]
  oneShot: boolean
  /** Read for the proxy variables and `CLAUDE_CODE_GZIP_REQUEST_BODIES`. */
  env: Env
}

/**
 * A per-request loopback server. It forwards the first Messages request and
 * refuses every later one. It never logs or stores the authorization header.
 */
export interface Relay {
  /** Value for `ANTHROPIC_BASE_URL`. Holds a random per-request route. */
  readonly url: string
  readonly used: boolean
  readonly denied: number
  /** HTTP status of the admitted upstream response. */
  readonly status: number | null
  /** Name of the local failure that ended the admitted request. */
  readonly failure: string | null
  readonly requestId: string | null
  /** Wait from the `retry-after` header of the admitted response, or null when none is usable. */
  readonly retryAfterMs: number | null
  /** Why the queried turn stayed as the CLI built it. Null when it was restored. */
  readonly unrestored: string | null
  readonly capture: StreamCapture
  /** The upstream's own message for a non-200 answer, or "" when none was captured. */
  errorText(): string
  /** Ends every open socket now. Safe to call more than once. */
  abort(): void
  /** Aborts, then stops listening. */
  close(): Promise<void>
}

export type CreateRelay = (options: RelayOptions) => Promise<Relay>

export interface PluginSettings {
  /** Bare name found through PATH, or an absolute path. */
  command: string
  /** Empty means the CLI's own default lookup. */
  claudeConfigDir: string
  claudeCodeTelemetry: boolean
  /** Seconds of CLI silence before a call fails. */
  readIdleTimeoutSeconds: number
}

/** Everything the process runner needs from outside. Tests pass fakes. */
export interface NativeDeps {
  subprocess: Pick<SubprocessRuntime, "spawn" | "resolveExecutable">
  createRelay: CreateRelay
  /** Read on every spawn, so a change applies to the next call. */
  settings(): PluginSettings
  /** The harness's own environment, used to detect conflicting overrides. */
  processEnv(): Env
  /** Absolute path of the built inert MCP server script. */
  inertMcpPath: string
  /** Absolute path of the Node binary that runs that script. */
  nodePath: string
}

/** One raw Anthropic stream event, as the CLI reports it in a `stream_event` line. */
export interface NativeStreamEvent extends JsonObject {
  type: string
}

/** A finished call. A failed call throws `NativeFailure` instead. */
export interface NativeCompletion {
  /** The native assistant turn as sent, for replay on later requests. */
  assistants: readonly CapturedMessage[]
  usage: NativeUsage
  requestId: string | null
  /** Extra Messages requests the CLI tried and the relay refused. */
  blockedRequests: number
  unrestored: string | null
}

/** Yields stream events as they arrive and returns the completion. */
export type RunNative = (
  request: PreparedRequest,
  signal: AbortSignal | undefined,
  deps: NativeDeps,
) => AsyncGenerator<NativeStreamEvent, NativeCompletion, void>

/** One row of the account's own model picker, as the CLI announced it. */
export interface DiscoveredModel {
  id: string
  name: string
  description?: string
}

/** Adapter-private data stored in a DSH `ReplayEnvelope.response`. */
export interface ReplayCarrier {
  kind: "claude-subscription"
  version: 1
  /** The native assistant turn as sent, signed thinking included. */
  messages: readonly CapturedMessage[]
  /** What DSH was told. A stored message that differs was edited, so its signatures are stale. */
  projection: ReplayProjection
}

export interface ReplayProjection {
  content: string
  toolCalls: readonly { id: string; name: string; input: unknown }[]
}
