import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import type {
  Env,
  JsonObject,
  NativeCompletion,
  NativeDeps,
  NativeFrame,
  NativeStreamEvent,
  PluginSettings,
  PreparedRequest,
} from "../../src/contract"
import { type FakeRelayControl, type FakeRelayState, fakeRelayControl } from "./fake-relay"
import { type LocalSubprocess, localSubprocess } from "./local-subprocess"

const FAKE_CLAUDE = fileURLToPath(new URL("../fixtures/fake-claude.mjs", import.meta.url))

export interface FakeClaudeStep {
  out?: JsonObject
  raw?: string
  err?: string
  touch?: string
  waitFor?: string
  sleepMs?: number
  flood?: number
  descendant?: { pidFile: string; inheritStdout?: boolean }
  exit?: number
}

/** What the fake CLI does. Read by `test/fixtures/fake-claude.mjs`. */
export interface FakeClaudeScenario {
  auth?: JsonObject
  authRaw?: string
  authScript?: FakeClaudeStep[]
  models?: unknown
  served?: unknown
  account?: JsonObject
  handshakeRaw?: string
  handshakeScript?: FakeClaudeStep[]
  afterHandshake?: FakeClaudeStep[]
  neverRead?: boolean
  atStart?: FakeClaudeStep[]
  afterFirstFrame?: FakeClaudeStep[]
  script?: FakeClaudeStep[]
}

export interface RecordedInvocation {
  argv: string[]
  env: Record<string, string>
  cwd: string
}

export interface RecordedFiles {
  directory: string
  system: string
  settings: { env: { CLAUDE_CODE_EXTRA_BODY: string } }
  tools: unknown
  mcp: { mcpServers: Record<string, { command: string; args: string[] }> }
}

export interface HarnessOptions {
  /** A function receives the temp root, for steps that wait on or touch a file. */
  scenario?: FakeClaudeScenario | ((root: string) => FakeClaudeScenario)
  relay?: Partial<FakeRelayState>
  settings?: Partial<PluginSettings>
  /** Extra harness environment, seen both by the plugin and by the child's ambient base. */
  env?: Env
  /** Name `settings().command` differently, for a missing CLI. */
  command?: string
}

export interface NativeHarness {
  readonly root: string
  readonly deps: NativeDeps
  readonly subprocess: LocalSubprocess
  readonly relay: FakeRelayControl
  settings: PluginSettings
  invocations(): RecordedInvocation[]
  frames(): { type: string; shouldQuery?: boolean; bytes: number }[]
  files(): RecordedFiles[]
  dispose(): Promise<void>
}

function writeWrapper(root: string): string {
  const path = join(root, "claude")
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

function recordedRows(path: string): JsonObject[] {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JsonObject)
}

/** One temp root, one fake CLI, one fake relay and the real child-process seam. */
export function nativeHarness(options: HarnessOptions = {}): NativeHarness {
  const root = mkdtempSync(join(tmpdir(), "native-harness-"))
  const record = join(root, "record.jsonl")
  const chosen = typeof options.scenario === "function" ? options.scenario(root) : options.scenario
  const scenario = { record, ...chosen }
  const ambient: Env = {
    PATH: process.env.PATH,
    HOME: root,
    FAKE_CLAUDE: JSON.stringify(scenario),
    ...options.env,
  }
  const subprocess = localSubprocess(ambient)
  const relay = fakeRelayControl(options.relay)
  const settings: PluginSettings = {
    command: options.command ?? writeWrapper(root),
    claudeConfigDir: "",
    claudeCodeTelemetry: true,
    readIdleTimeoutSeconds: 30,
    ...options.settings,
  }
  const harness: NativeHarness = {
    root,
    subprocess,
    relay,
    settings,
    deps: {
      subprocess,
      createRelay: relay.create,
      settings: () => harness.settings,
      processEnv: () => ambient,
      inertMcpPath: "/fixture/inert-mcp.js",
      nodePath: process.execPath,
    },
    invocations: () =>
      recordedRows(record)
        .filter((row) => row.argv !== undefined)
        .map((row) => row as unknown as RecordedInvocation),
    frames: () =>
      recordedRows(record)
        .filter((row) => row.frame !== undefined)
        .map((row) => row.frame as { type: string; shouldQuery?: boolean; bytes: number }),
    files: () =>
      recordedRows(record)
        .filter((row) => row.files !== undefined)
        .map((row) => row.files as RecordedFiles),
    async dispose() {
      await subprocess.terminateAll()
      rmSync(root, { recursive: true, force: true })
    },
  }
  return harness
}

const USER_FRAME: NativeFrame = {
  type: "user",
  message: { role: "user", content: [{ type: "text", text: "fixture" }] },
}

export function userFrame(text: string): NativeFrame {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } }
}

export function assistantFrame(text: string): NativeFrame {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }
}

export const REPLAYED_HISTORY: readonly NativeFrame[] = [
  userFrame("earlier"),
  assistantFrame("ok"),
  userFrame("now"),
]

export function preparedRequest(overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    nativeModel: "claude-sonnet-5-5[1m]",
    system: "fixture system",
    frames: [USER_FRAME],
    extraBody: { tools: [] },
    manifest: [],
    toolNames: new Map(),
    sessionId: "11111111-1111-4111-8111-111111111111",
    oneShot: false,
    ...overrides,
  }
}

export interface DrainedRun {
  events: NativeStreamEvent[]
  completion: NativeCompletion
}

/** Runs a generator to its end and keeps every yielded event. */
export async function drainRun(
  generator: AsyncGenerator<NativeStreamEvent, NativeCompletion, void>,
): Promise<DrainedRun> {
  const events: NativeStreamEvent[] = []
  while (true) {
    const step = await generator.next()
    if (step.done === true) return { events, completion: step.value }
    events.push(step.value)
  }
}

export async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error("the expected state was not reached in time")
    await sleep(5)
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  // A dead child stays visible until its parent reaps it, so read its state as well.
  try {
    return !/^\S+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"))
  } catch {
    return false
  }
}

const TEXT_DELTA = (text: string): JsonObject => ({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { type: "text_delta", text } },
})
const MESSAGE_STOP: JsonObject = { type: "stream_event", event: { type: "message_stop" } }
const USAGE = { input_tokens: 3, output_tokens: 2 }

/** The stdout rows of a clean answer whose text the fake relay also captured. */
export function cleanAnswer(result: JsonObject = {}): FakeClaudeStep[] {
  return [
    { out: TEXT_DELTA("FIRST") },
    {
      out: {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "FIRST" }], usage: USAGE },
      },
    },
    { out: MESSAGE_STOP },
    { out: { type: "result", subtype: "success", is_error: false, usage: USAGE, ...result } },
  ]
}

/** An error the CLI answers itself: an `assistant` row with an `error` code and a result. */
export function nativeErrorAnswer(code: string, text: string): FakeClaudeStep[] {
  return [
    {
      out: {
        type: "assistant",
        error: code,
        message: {
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text }],
          stop_reason: "stop_sequence",
        },
      },
    },
    { out: { type: "result", subtype: "success", is_error: true, num_turns: 1, result: text } },
    { exit: 1 },
  ]
}
