import { homedir, userInfo } from "node:os"
import { join } from "node:path"
import type { Env, PluginSettings } from "../contract"
import { FailureCode, NativeFailure } from "../errors"

const BACKEND_URL = "ANTHROPIC_BASE_URL"
const LOOPBACK = "127.0.0.1"
const BACKEND_SWITCHES = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const
const SWITCHED_OFF: ReadonlySet<string> = new Set(["", "0", "false", "no", "off"])

// DSH already scrubs these from the ambient environment. They are removed here as well, so the
// child's login stays the CLI's own even if a future DSH scrubs less.
const FOREIGN_CREDENTIALS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_FOUNDRY_API_KEY",
] as const

// An inherited effort level would override the `--effort` value of the request.
const INHERITED_REQUEST_SETTINGS = ["CLAUDE_CODE_EXTRA_BODY", "CLAUDE_CODE_EFFORT_LEVEL"] as const

// Any one of these turns off the CLI's feature-flag fetch, and with it every model that its
// picker offers only through a flag (upstream #86). So they stay off unless the user asks.
const QUIET_TRAFFIC = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
} as const

const ALWAYS_QUIET = {
  DISABLE_AUTOUPDATER: "1",
  DISABLE_FEEDBACK_COMMAND: "1",
  // This also stops the CLI's own session-title request, which would race the turn for the one
  // upstream request that the relay admits (upstream #116).
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
} as const

// The CLI names its caller on every request, and an inherited name would reach the child.
// A caller outside the `sdk-*` names is offered the artifact tool, so that tool is turned off.
const CALLER_IDENTITY = {
  CLAUDE_CODE_ENTRYPOINT: "deepseek-harness",
  CLAUDE_CODE_DISABLE_ARTIFACT: "1",
} as const

const TURN_POLICY = {
  ENABLE_TOOL_SEARCH: "false",
  CLAUDE_CODE_MAX_RETRIES: "0",
  DISABLE_AUTO_COMPACT: "1",
  DISABLE_COMPACT: "1",
  // DSH owns the budgets, and the CLI's replayed reminder would break the cached history.
  CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
  // The CLI adds this note to the history after quiet tool turns. A DSH turn did not ask for it, and
  // its time-based form could move the cached prefix.
  CLAUDE_CODE_SILENT_TURN_REMINDER: "0",
  // DSH owns memory and instructions. `--setting-sources ""` does not stop these two, and the CLI
  // would put them inside the user's turn (upstream #195).
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
} as const

function isSwitchedOn(value: string | undefined): boolean {
  return value !== undefined && !SWITCHED_OFF.has(value.trim().toLowerCase())
}

/** The names of the variables that would send the child to another backend. */
export function backendOverrides(processEnv: Env): string[] {
  const conflicts = processEnv[BACKEND_URL] ? [BACKEND_URL] : []
  return [...conflicts, ...BACKEND_SWITCHES.filter((name) => isSwitchedOn(processEnv[name]))]
}

/** Raises `conflictingEnvironment`, naming the variables and never their values. */
export function assertNoBackendOverride(processEnv: Env): void {
  const conflicts = backendOverrides(processEnv)
  if (conflicts.length === 0) return
  throw new NativeFailure(
    `The Claude subscription provider refuses these inherited backend overrides: ${conflicts.join(", ")}. Unset them where DSH runs.`,
    FailureCode.conflictingEnvironment,
  )
}

function expandHome(path: string, processEnv: Env): string {
  if (path !== "~" && !path.startsWith("~/")) return path
  return join(processEnv.HOME || homedir(), path.slice(1))
}

function configDirEntry(settings: PluginSettings, processEnv: Env): NodeJS.ProcessEnv {
  const chosen = settings.claudeConfigDir.trim() || processEnv.CLAUDE_CONFIG_DIR
  return chosen ? { CLAUDE_CONFIG_DIR: expandHome(chosen, processEnv) } : {}
}

function osUsername(): string | undefined {
  try {
    return userInfo().username
  } catch {
    // A service user with no passwd entry makes this throw. The CLI then answers logged out.
    return undefined
  }
}

// Without USER a logged-in CLI reports `loggedIn: false`, at once and with no stderr (upstream
// #44). A supervised service can start without it.
function loginIdentity(processEnv: Env): NodeJS.ProcessEnv {
  const user = processEnv.USER || processEnv.LOGNAME || osUsername()
  if (user === undefined) return {}
  return { USER: processEnv.USER || user, LOGNAME: processEnv.LOGNAME || user }
}

// The CLI sends even loopback requests through a proxy. The relay speaks plain HTTP, so a proxy
// would read the login's bearer token and the relay's private route.
function loopbackProxyBypass(processEnv: Env): NodeJS.ProcessEnv {
  const inherited = processEnv.no_proxy || processEnv.NO_PROXY
  const exceptions = inherited ? `${inherited},${LOOPBACK}` : LOOPBACK
  return { NO_PROXY: exceptions, no_proxy: exceptions }
}

function removed(names: readonly string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(names.map((name) => [name, undefined]))
}

/** Explicit child entries for the setup probes: `auth status` and the `initialize` handshake. */
export function probeEnv(settings: PluginSettings, processEnv: Env): NodeJS.ProcessEnv {
  return {
    ...removed([...FOREIGN_CREDENTIALS, BACKEND_URL]),
    ...loginIdentity(processEnv),
    ...configDirEntry(settings, processEnv),
    ...loopbackProxyBypass(processEnv),
    ...ALWAYS_QUIET,
    ...CALLER_IDENTITY,
    ...(settings.claudeCodeTelemetry ? {} : QUIET_TRAFFIC),
  }
}

/** Explicit child entries for a model call. `undefined` removes an ambient entry. */
export function nativeEnv(settings: PluginSettings, processEnv: Env): NodeJS.ProcessEnv {
  return {
    ...probeEnv(settings, processEnv),
    ...removed(INHERITED_REQUEST_SETTINGS),
    ...TURN_POLICY,
  }
}
