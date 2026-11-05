import type { DiscoveredModel, Env, JsonObject, NativeDeps, Relay } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { backendOverrides, probeEnv } from "./env"
import { resolveClaude } from "./executable"
import {
  INSTALL_HINT,
  LOGGED_OUT_HINT,
  LOGIN_HINT,
  stderrSuffix,
  throwIfAborted,
  withoutRelayRoute,
} from "./failures"
import { mergePicker } from "./picker"
import { type ProbeOutput, runProbe, withProbeDirectory } from "./probe"

const AUTH_STATUS_TIMEOUT_MS = 20_000
const HANDSHAKE_TIMEOUT_MS = 40_000
const ANTHROPIC_API = "https://api.anthropic.com"
const HANDSHAKE_REQUEST = `${JSON.stringify({
  type: "control_request",
  request_id: "dsh-picker",
  request: { subtype: "initialize" },
})}\n`
const HANDSHAKE_ARGS = [
  "-p",
  "--model",
  "sonnet",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--tools",
  "",
  "--setting-sources",
  "",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--disable-slash-commands",
  "--no-session-persistence",
] as const

/** What the CLI says about itself and its login. */
export interface SetupStatus {
  installed: boolean
  loggedIn: boolean
  /** A label for display, such as `Claude Pro`. */
  subscriptionType?: string
  /** What the user should do next. */
  detail?: string
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function protocolFailure(what: string, output: ProbeOutput, cause?: unknown): NativeFailure {
  return new NativeFailure(
    `${what}${stderrSuffix(output.stderr)}`,
    FailureCode.nativeProtocol,
    cause === undefined ? {} : { cause },
  )
}

// `pro` from `auth status` and `Claude Pro` from the handshake name the same plan.
function planLabel(raw: string): string {
  if (raw.toLowerCase().startsWith("claude")) return raw
  const words = raw.split("_").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
  return `Claude ${words.join(" ")}`
}

function parseAuthStatus(output: ProbeOutput): JsonObject {
  const text = output.stdout.trim()
  try {
    const parsed: unknown = JSON.parse(text)
    if (isJsonObject(parsed)) return parsed
  } catch (error) {
    throw protocolFailure(unreadableAuth(text), output, error)
  }
  throw protocolFailure(unreadableAuth(text), output)
}

function unreadableAuth(text: string): string {
  return `Could not read \`claude auth status\`: ${JSON.stringify(text.slice(0, 300))}`
}

function statusFrom(auth: JsonObject): SetupStatus {
  const plan = typeof auth.subscriptionType === "string" ? auth.subscriptionType.trim() : ""
  const loggedIn = auth.loggedIn === true
  return {
    installed: true,
    loggedIn,
    ...(plan === "" ? {} : { subscriptionType: planLabel(plan) }),
    ...(loggedIn ? {} : { detail: LOGIN_HINT }),
  }
}

async function resolveOrMissing(deps: NativeDeps, signal?: AbortSignal): Promise<string | null> {
  try {
    return await resolveClaude(deps, signal)
  } catch (error) {
    if (error instanceof NativeFailure && error.code === FailureCode.claudeCodeMissing) return null
    throw error
  }
}

/**
 * The login state from the CLI's own `auth status`, which reads only its local store. A missing
 * CLI and a logged-out CLI are answers. Output that cannot be read raises `nativeProtocol`.
 */
export async function setupStatus(deps: NativeDeps, signal?: AbortSignal): Promise<SetupStatus> {
  throwIfAborted(signal)
  const executable = await resolveOrMissing(deps, signal)
  if (executable === null) return { installed: false, loggedIn: false, detail: INSTALL_HINT }
  const output = await withProbeDirectory((cwd) =>
    runProbe(deps, {
      argv: [executable, "auth", "status"],
      stdin: "ignore",
      env: probeEnv(deps.settings(), deps.processEnv()),
      cwd,
      timeoutMs: AUTH_STATUS_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return statusFrom(parseAuthStatus(output))
}

async function assertLoggedIn(deps: NativeDeps, signal?: AbortSignal): Promise<void> {
  const status = await setupStatus(deps, signal)
  if (!status.installed) {
    throw new NativeFailure(INSTALL_HINT, FailureCode.claudeCodeMissing, { status: 503 })
  }
  if (!status.loggedIn) {
    throw new NativeFailure(LOGGED_OUT_HINT, FailureCode.invalidCredential, { status: 401 })
  }
}

interface HandshakeAnswer {
  rows: JsonObject[]
  plan: string
  output: ProbeOutput
}

function parseRows(output: ProbeOutput): JsonObject[] {
  const lines = output.stdout.split("\n").filter((line) => line.startsWith("{"))
  try {
    return lines.map((line) => JSON.parse(line) as JsonObject)
  } catch (error) {
    throw protocolFailure("Invalid output from the Claude Code handshake", output, error)
  }
}

function field(value: unknown, name: string): unknown {
  return isJsonObject(value) ? value[name] : undefined
}

function parseHandshake(output: ProbeOutput): HandshakeAnswer {
  const answer = parseRows(output).find((row) => row.type === "control_response")
  if (answer === undefined) {
    throw protocolFailure("Claude Code did not answer the model handshake", output)
  }
  const body = field(answer.response, "response")
  const rows = field(body, "models")
  if (!Array.isArray(rows) || !rows.every(isJsonObject)) {
    throw protocolFailure("The model handshake holds no list of models", output)
  }
  const plan = field(field(body, "account"), "subscriptionType")
  return { rows, plan: typeof plan === "string" ? plan : "", output }
}

function handshakeRelay(deps: NativeDeps, processEnv: Env): Promise<Relay | null> {
  if (backendOverrides(processEnv).length === 0) return Promise.resolve(null)
  return deps.createRelay({
    upstream: ANTHROPIC_API,
    timeoutMs: HANDSHAKE_TIMEOUT_MS,
    queried: [],
    oneShot: false,
    env: processEnv,
  })
}

/**
 * The account's own picker comes from the CLI's served catalog, and the CLI serves it only
 * first-party: behind any `ANTHROPIC_BASE_URL`, our relay included, it answers a generic list. So
 * the handshake talks to Anthropic directly. It writes only `initialize` and closes stdin, so the
 * CLI has no user turn to query. An inherited backend override keeps the relay, so that the
 * login never leaves for that backend, and the relay then proves no request was made.
 */
async function runHandshake(
  deps: NativeDeps,
  executable: string,
  signal?: AbortSignal,
): Promise<HandshakeAnswer> {
  const processEnv = deps.processEnv()
  const relay = await handshakeRelay(deps, processEnv)
  try {
    const env = probeEnv(deps.settings(), processEnv)
    if (relay !== null) env.ANTHROPIC_BASE_URL = relay.url
    const raw = await withProbeDirectory((cwd) =>
      runProbe(deps, {
        argv: [executable, ...HANDSHAKE_ARGS],
        stdin: { data: HANDSHAKE_REQUEST },
        env,
        cwd,
        timeoutMs: HANDSHAKE_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
      }),
    )
    const output =
      relay === null ? raw : { ...raw, stderr: withoutRelayRoute(raw.stderr, relay.url) }
    if (relay?.used === true) {
      throw protocolFailure("The model handshake sent a model request", output)
    }
    return parseHandshake(output)
  } finally {
    await relay?.close()
  }
}

/**
 * The models this account can pick, merged with the pinned catalog by `mergePicker`.
 * Raises `NativeFailure` when the CLI is missing, logged out, or cannot answer. There is no
 * pinned list to fall back on.
 */
export async function discoverModels(
  deps: NativeDeps,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  await assertLoggedIn(deps, signal)
  const executable = await resolveClaude(deps, signal)
  const answer = await runHandshake(deps, executable, signal)
  const models = mergePicker(answer.rows, answer.plan)
  if (models.length === 0) {
    throw protocolFailure("The model handshake advertised no model", answer.output)
  }
  return models
}
