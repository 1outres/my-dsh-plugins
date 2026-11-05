/**
 * The real `claude` binary, the real plugin code and a synthetic loopback Messages peer. It uses
 * no credentials and no inference. Run through the package's `eval` script, or see `run-all.mjs`.
 */
import { resolve } from "node:path"
import type {
  AssistantMessage,
  GenerateOptions,
  RequestMessage,
  StreamChunk,
  TokenUsage,
} from "@deepseek-ai/dsh-llm"
import type { NativeBlock } from "../src/contract"
import { imageBlock, imageRef } from "../test/support/attachments"
import { assistant, developer, system, text, toolResult, user } from "../test/support/messages"
import { type Checks, type EvalCase, type Facts, runEval } from "./support/check"
import {
  type Call,
  call,
  READ_FILE,
  reasoningOf,
  requestOf,
  textOf,
  toolCallsOf,
} from "./support/conversation"
import type { Answer, PeerRequest } from "./support/peer"
import {
  binaryReceipt,
  FIXTURE_API_KEY,
  openRig,
  type Rig,
  type RigOptions,
  strayRequestDirectories,
} from "./support/rig"
import { arrayField, messageMarks, messagesOf, wireBlocks, withoutMarks } from "./support/wire"

const FIXTURE_TEXT = "FIRST λ"
const SYSTEM_PROMPT = "Eval system prompt. The workspace is /eval/workspace."
const TEXT: NativeBlock = { type: "text", text: FIXTURE_TEXT }
const THINKING: NativeBlock = {
  type: "thinking",
  thinking: "fixture thought",
  signature: "fixture-signature",
}
const TOOL_CALL: NativeBlock = {
  type: "tool_use",
  id: "host_tool_1",
  name: "mcp__dsh__read_file",
  input: { path: "fixture.txt" },
}
const OUTSIDE_TOOL_NAME = "mcp__fastmail__draft_email"
const OUTSIDE_TOOL_CALL: NativeBlock = {
  type: "tool_use",
  id: "host_tool_1",
  name: OUTSIDE_TOOL_NAME,
  input: { to: "fixture" },
}
const EXPECTED_USAGE: TokenUsage = {
  inputTokens: 101,
  outputTokens: 37,
  totalTokens: 662,
  cacheReadTokens: 211,
  cacheWriteTokens: 313,
}
// A DSH name at the 64 character limit, which the CLI's own limit forces onto an alias.
const LONG_TOOL_NAME = `long_tool_${"x".repeat(54)}`
const MCP_NAME_LIMIT = 64
const CANCEL_LIMIT_SECONDS = 3
const DISCONNECT_LIMIT_MS = 2_000
const PROCESS_EXIT_LIMIT_MS = 10_000

const binary = resolve(process.argv[2] ?? "")

function firstTurn(): RequestMessage[] {
  return [system(SYSTEM_PROMPT), user("Local protocol fixture")]
}

function withTools(messages: readonly RequestMessage[]): GenerateOptions {
  return requestOf(messages, { tools: [READ_FILE], maxTokens: 2400 })
}

function stream(blocks: readonly NativeBlock[], stop: string | null): Answer {
  return { kind: "stream", blocks, stop }
}

function withoutRoute(checks: Checks, finish: Call["finish"]): void {
  if (finish.kind !== "error" && finish.kind !== "aborted") return
  checks.ok("no relay route in the failure", !finish.failure.message.includes("/admit/"))
}

function checkOneRequest(checks: Checks, rig: Rig, expected = 1): void {
  checks.equal("upstream requests", rig.peer.requests.length, expected)
  checks.equal("other requests at the peer", rig.peer.others, [])
}

function checkAuthHeaders(checks: Checks, request: PeerRequest): void {
  checks.equal("fake key reaches the peer", request.headers["x-api-key"], FIXTURE_API_KEY)
  checks.equal("no bearer token", request.headers.authorization, undefined)
}

/** What every request of a call with tools must hold, whatever the case is about. */
function checkToolRequest(checks: Checks, request: PeerRequest): void {
  checkAuthHeaders(checks, request)
  const tools = request.body.tools as { name: string }[]
  checks.equal(
    "tools on the wire",
    tools.map((tool) => tool.name),
    ["mcp__dsh__read_file"],
  )
  checks.equal("system prompt on the wire", hasSystemText(request, SYSTEM_PROMPT), true)
  checks.equal("max_tokens on the wire", request.body.max_tokens, 2400)
  checks.equal("stream flag", request.body.stream, true)
}

function hasSystemText(request: PeerRequest, text: string): boolean {
  return JSON.stringify(request.body.system).includes(text)
}

function usageChunks(result: Call): StreamChunk[] {
  return result.chunks.filter((chunk) => chunk.type === "usage")
}

function checkChunkOrder(checks: Checks, result: Call): void {
  const types = result.chunks.map((chunk) => chunk.type)
  checks.equal("finish is the last chunk", types.at(-1), "finish")
  checks.equal("exactly one finish", types.filter((type) => type === "finish").length, 1)
  if (usageChunks(result).length > 0) {
    checks.equal("usage comes just before finish", types.at(-2), "usage")
  }
}

function checkUsage(checks: Checks, result: Call): void {
  const [chunk] = usageChunks(result)
  checks.equal("usage", chunk?.type === "usage" ? chunk.usage : undefined, EXPECTED_USAGE)
}

async function processesGone(rig: Rig): Promise<boolean> {
  const signal = AbortSignal.timeout(PROCESS_EXIT_LIMIT_MS)
  const exits = rig.subprocess.spawned.map(({ handle }) => handle.waitForExit(signal))
  return (await Promise.all(exits)).every(Boolean)
}

/** A clean answer returns before the CLI exits, so this waits for what comes after it too. */
async function checkCleanedUp(checks: Checks, rig: Rig): Promise<void> {
  checks.equal("CLI and MCP processes end", await processesGone(rig), true)
  checks.equal("per-request files removed", strayRequestDirectories(rig.tmp), [])
}

async function withRig(
  options: Omit<RigOptions, "binary">,
  run: (rig: Rig) => Promise<void>,
): Promise<void> {
  const rig = await openRig({ ...options, binary })
  try {
    await run(rig)
  } finally {
    await rig.close()
  }
}

function evalCase(
  name: string,
  run: (rig: Rig, checks: Checks, facts: Facts) => Promise<void>,
  rigOptions: Omit<RigOptions, "binary"> = {},
): EvalCase {
  return {
    name,
    run: (checks, facts) =>
      withRig(rigOptions, async (rig) => {
        await run(rig, checks, facts)
        facts.deniedRetries = rig.relays.map(({ relay }) => relay.denied)
      }),
  }
}

function finalCase(): EvalCase {
  return evalCase("final", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish", first.finish, { kind: "stop" })
    checks.equal("text", textOf(first), FIXTURE_TEXT)
    checkUsage(checks, first)
    checkChunkOrder(checks, first)
    checkOneRequest(checks, rig)
    checkToolRequest(checks, rig.peer.last)
    checks.ok("replay state", first.assembler.replayState !== undefined)
    checks.equal("no warnings", rig.warnings, [])
    const { headers } = rig.peer.last
    facts.wire = { model: rig.peer.last.body.model, beta: headers["anthropic-beta"] }
    facts.userAgent = headers["user-agent"]

    const next = await call(rig, withTools([...firstTurn(), first.stored, user("Second question")]))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checkOneRequest(checks, rig, 2)
    const wire = messagesOf(rig.peer.last.body)
    facts.roles = wire.map((message) => message.role)
    checks.equal("replayed answer", wireBlocks(rig.peer.last.body, "assistant"), [TEXT])
    checks.equal("newest turn is the frame alone", wire.at(-1)?.content.length, 1)
    await checkCleanedUp(checks, rig)
  })
}

function toolsCase(): EvalCase {
  return evalCase("tools", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT, TOOL_CALL], "tool_use")
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish", first.finish, { kind: "tool-calls" })
    checks.equal(
      "tool call as DSH sees it",
      toolCallsOf(first).map(({ id, name, arguments: args }) => ({ id, name, args })),
      [{ id: "host_tool_1", name: "read_file", args: '{"path":"fixture.txt"}' }],
    )
    checkUsage(checks, first)
    checkChunkOrder(checks, first)
    checkOneRequest(checks, rig)
    checkToolRequest(checks, rig.peer.last)

    rig.peer.answer = () => stream([TEXT], "end_turn")
    const history = [...firstTurn(), first.stored, toolResult("host_tool_1", "fixture content")]
    const next = await call(rig, withTools(history))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checkOneRequest(checks, rig, 2)
    checks.equal("no warnings", rig.warnings, [])
    checks.equal("replayed assistant", wireBlocks(rig.peer.last.body, "assistant"), [
      TEXT,
      TOOL_CALL,
    ])
    const newest = messagesOf(rig.peer.last.body).at(-1)
    checks.equal("restored tool result, no reminder", newest?.content, [
      {
        type: "tool_result",
        tool_use_id: "host_tool_1",
        content: "fixture content",
        ...markOf(newest?.content),
      },
    ])
    await checkCleanedUp(checks, rig)
  })
}

function markOf(content: unknown): { cache_control?: unknown } {
  const [only] = Array.isArray(content) ? (content as NativeBlock[]) : []
  return only?.cache_control === undefined ? {} : { cache_control: only.cache_control }
}

function cutOffCase(name: string, blocks: readonly NativeBlock[], stop: string): EvalCase {
  return evalCase(name, async (rig, checks, facts) => {
    rig.peer.answer = () => stream(blocks, stop)
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish", first.finish, { kind: "max-tokens" })
    checks.equal("text", textOf(first), FIXTURE_TEXT)
    checks.equal("no runnable tool call", toolCallsOf(first), [])
    checkUsage(checks, first)
    checkChunkOrder(checks, first)
    checkOneRequest(checks, rig)

    const hadToolCall = blocks.some((block) => block.type === "tool_use")
    checks.equal("replay state", first.assembler.replayState === undefined, hadToolCall)
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const next = await call(rig, withTools([...firstTurn(), first.stored, user("Go on")]))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal("replayed assistant", wireBlocks(rig.peer.last.body, "assistant"), [TEXT])
    await checkCleanedUp(checks, rig)
  })
}

function thinkingOnlyCase(): EvalCase {
  return evalCase("thinking-only", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([THINKING], "end_turn")
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish kind", first.finish.kind, "error")
    if (first.finish.kind === "error") {
      checks.equal("failure code", first.finish.failure.code, "EMPTY_RESPONSE")
    }
    checks.equal("thinking was shown", reasoningOf(first), THINKING.thinking)
    checkChunkOrder(checks, first)
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function refusalCase(): EvalCase {
  return evalCase("refusal", async (rig, checks, facts) => {
    rig.peer.answer = () => ({
      kind: "stream",
      blocks: [TEXT],
      stop: "refusal",
      stopDetails: { type: "refusal", category: "fixture", explanation: "Fixture refusal." },
    })
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish kind", first.finish.kind, "error")
    if (first.finish.kind === "error") {
      checks.equal("failure", first.finish.failure, {
        code: "CONTENT_FILTER",
        message: "Fixture refusal.",
      })
    }
    checks.equal("no tool call", toolCallsOf(first), [])
    checkChunkOrder(checks, first)
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function errorBody(type: string, message: string): string {
  return JSON.stringify({ type: "error", error: { type, message } })
}

function httpErrorCase(
  name: string,
  status: number,
  body: string,
  expected: { code: string; message: string },
): EvalCase {
  return evalCase(name, async (rig, checks, facts) => {
    rig.peer.answer = () => ({ kind: "status", status, body })
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish kind", first.finish.kind, "error")
    if (first.finish.kind === "error") {
      const { failure } = first.finish
      facts.failure = failure.message
      checks.equal("failure code", failure.code, expected.code)
      checks.equal("failure status", failure.status, status)
      checks.ok("upstream text survives", failure.message.includes(expected.message), failure)
    }
    withoutRoute(checks, first.finish)
    checks.equal("no text", textOf(first), "")
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function cutShortCase(name: string, answer: Answer): EvalCase {
  return evalCase(name, async (rig, checks, facts) => {
    rig.peer.answer = () => answer
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish kind", first.finish.kind, "error")
    if (first.finish.kind === "error") {
      facts.failure = first.finish.failure.message
      checks.equal("failure code", first.finish.failure.code, "TRANSPORT")
    }
    withoutRoute(checks, first.finish)
    checks.equal("no replay state", first.assembler.replayState, undefined)
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function cancelCase(): EvalCase {
  return evalCase("cancel", async (rig, checks, facts) => {
    rig.peer.answer = () => ({ kind: "hang" })
    const controller = new AbortController()
    const pending = call(rig, { ...withTools(firstTurn()), signal: controller.signal })
    await rig.peer.entered
    const started = performance.now()
    controller.abort()
    const result = await pending
    const seconds = (performance.now() - started) / 1000
    facts.cancelSeconds = seconds
    checks.ok(`cancel within ${CANCEL_LIMIT_SECONDS}s`, seconds < CANCEL_LIMIT_SECONDS, seconds)
    checks.equal("finish kind", result.finish.kind, "aborted")
    withoutRoute(checks, result.finish)
    const disconnected = await Promise.race([
      rig.peer.disconnected.then(() => true),
      new Promise<boolean>((done) => setTimeout(() => done(false), DISCONNECT_LIMIT_MS)),
    ])
    checks.equal("upstream connection closed", disconnected, true)
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function outsideToolCase(): EvalCase {
  return evalCase("unknown-tool", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT, OUTSIDE_TOOL_CALL], "tool_use")
    const first = await call(rig, withTools(firstTurn()))
    facts.seconds = first.seconds
    checks.equal("finish", first.finish, { kind: "tool-calls" })
    checks.equal(
      "the name reaches DSH as it is",
      toolCallsOf(first).map((block) => block.name),
      [OUTSIDE_TOOL_NAME],
    )
    checkOneRequest(checks, rig)

    rig.peer.answer = () => stream([TEXT], "end_turn")
    const refusal = `Tool '${OUTSIDE_TOOL_NAME}' does not exist. Available tools: read_file`
    const next = await call(
      rig,
      withTools([...firstTurn(), first.stored, toolResult("host_tool_1", refusal, true)]),
    )
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal("second text", textOf(next), FIXTURE_TEXT)
    checks.equal(
      "replayed tool name",
      wireBlocks(rig.peer.last.body, "assistant")
        .filter((block) => block.type === "tool_use")
        .map((block) => block.name),
      [OUTSIDE_TOOL_NAME],
    )
    checkOneRequest(checks, rig, 2)
    await checkCleanedUp(checks, rig)
  })
}

function signedThinkingCase(): EvalCase {
  const toolTurn: NativeBlock = { ...THINKING, signature: "fixture-signature-tool-turn" }
  const textTurn: NativeBlock = {
    type: "thinking",
    thinking: "second thought λ",
    signature: "fixture-signature-text-turn",
  }
  return evalCase("signed-thinking-replay", async (rig, checks) => {
    rig.peer.answer = () => stream([toolTurn, TOOL_CALL], "tool_use")
    const first = await call(rig, withTools(firstTurn()))
    checks.equal("first finish", first.finish, { kind: "tool-calls" })

    rig.peer.answer = () => stream([textTurn, TEXT], "end_turn")
    const afterTool = [...firstTurn(), first.stored, toolResult("host_tool_1", "fixture content")]
    const second = await call(rig, withTools(afterTool))
    checks.equal("second finish", second.finish, { kind: "stop" })
    checks.equal(
      "thinking block on the tool continuation",
      withoutMarks(wireBlocks(rig.peer.last.body, "assistant")),
      [toolTurn, TOOL_CALL],
    )

    rig.peer.answer = () => stream([TEXT], "end_turn")
    // DSH stores a session as JSON, so a stored message must survive that.
    const reloaded = JSON.parse(JSON.stringify(second.stored)) as AssistantMessage
    const third = await call(rig, withTools([...afterTool, reloaded, user("Next turn")]))
    checks.equal("third finish", third.finish, { kind: "stop" })
    checks.equal(
      "every signed block unchanged, in order",
      withoutMarks(wireBlocks(rig.peer.last.body, "assistant")),
      [toolTurn, TOOL_CALL, textTurn, TEXT],
    )
    checkOneRequest(checks, rig, 3)
    await checkCleanedUp(checks, rig)
  })
}

function longToolNameCase(): EvalCase {
  const tool = { ...READ_FILE, name: LONG_TOOL_NAME }
  return evalCase("long-tool-name", async (rig, checks, facts) => {
    let offered = ""
    rig.peer.answer = (request) => {
      const [first] = request.body.tools as { name: string }[]
      offered = first?.name ?? ""
      return stream([{ ...TOOL_CALL, name: offered }], "tool_use")
    }
    const options = (messages: readonly RequestMessage[]) => requestOf(messages, { tools: [tool] })
    const first = await call(rig, options(firstTurn()))
    facts.wireName = offered
    checks.ok("the wire name fits the CLI's limit", offered.length <= MCP_NAME_LIMIT, offered)
    checks.ok("the wire name is the prefixed alias", offered.startsWith("mcp__dsh__"), offered)
    checks.ok("the wire name differs from the DSH name", !offered.endsWith(LONG_TOOL_NAME), offered)
    checks.equal(
      "DSH gets its own name back",
      toolCallsOf(first).map((block) => block.name),
      [LONG_TOOL_NAME],
    )

    rig.peer.answer = () => stream([TEXT], "end_turn")
    const next = await call(
      rig,
      options([...firstTurn(), first.stored, toolResult("host_tool_1", "fixture content")]),
    )
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal(
      "the replayed call keeps the alias",
      wireBlocks(rig.peer.last.body, "assistant").map((block) => block.name),
      [offered],
    )
    checkOneRequest(checks, rig, 2)
    await checkCleanedUp(checks, rig)
  })
}

function sessionTitleCase(): EvalCase {
  return evalCase("session-title", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([{ type: "text", text: "Fixture title" }], "end_turn")
    const titlePrompt = "Write a short title for this conversation."
    const result = await call(
      rig,
      requestOf([user("Conversation to name.")], {
        purpose: "session-title",
        system: titlePrompt,
      }),
    )
    facts.seconds = result.seconds
    checks.equal("finish", result.finish, { kind: "stop" })
    checks.equal("text", textOf(result), "Fixture title")
    checkOneRequest(checks, rig)
    checkAuthHeaders(checks, rig.peer.last)
    const { body } = rig.peer.last
    checks.equal("one-shot flag reached the relay", rig.relays[0]?.options.oneShot, true)
    checks.equal("no tools on the wire", body.tools, [])
    checks.equal("no message cache mark", messageMarks(body), [])
    checks.equal("system text on the wire", hasSystemText(rig.peer.last, titlePrompt), true)
    checks.equal("the frame alone", wireBlocks(body, "user"), [
      { type: "text", text: "Conversation to name." },
    ])
    await checkCleanedUp(checks, rig)
  })
}

function effort(id: string): NonNullable<GenerateOptions["reasoningEffort"]> {
  return id as unknown as NonNullable<GenerateOptions["reasoningEffort"]>
}

/** What the CLI does with generation fields, on a route of the plugin's choice. */
function generationCase(
  name: string,
  extra: Partial<GenerateOptions>,
  expected: Record<string, unknown>,
  expectedArgv: readonly string[] = [],
): EvalCase {
  return evalCase(name, async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const result = await call(rig, { ...withTools(firstTurn()), ...extra })
    checks.equal("finish", result.finish, { kind: "stop" })
    checkOneRequest(checks, rig)
    const { body, headers } = rig.peer.last
    const seen = Object.fromEntries(Object.keys(expected).map((key) => [key, body[key]]))
    facts.wire = {
      model: body.model,
      thinking: body.thinking,
      output_config: body.output_config,
      context_management: body.context_management,
      beta: headers["anthropic-beta"],
    }
    checks.equal("generation fields", seen, expected)
    const argv = rig.subprocess.spawned[0]?.spec.argv ?? []
    for (const part of expectedArgv) checks.ok(`argv holds ${part}`, argv.includes(part), argv)
    await checkCleanedUp(checks, rig)
  })
}

function noSystemCase(): EvalCase {
  return evalCase("no-system-prompt", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const result = await call(rig, requestOf([user("Local protocol fixture")]))
    checks.equal("finish", result.finish, { kind: "stop" })
    checkOneRequest(checks, rig)
    facts.systemBlocks = arrayField(rig.peer.last.body, "system").map((block) =>
      String(block.text).slice(0, 100),
    )
    await checkCleanedUp(checks, rig)
  })
}

// Far above the 128 KiB Linux limit for one argument or one environment string.
function largeRequestCase(): EvalCase {
  const tools = Array.from({ length: 150 }, (_, index) => ({
    ...READ_FILE,
    name: `tool_${index}`,
    description: "Long fixture description. ".repeat(100),
  }))
  const hugeSystem = "Long fixture system prompt.\n".repeat(20_000)
  return evalCase("large-request", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const result = await call(
      rig,
      requestOf([system(hugeSystem), user("Local protocol fixture")], { tools }),
    )
    facts.requestBytes = rig.peer.requests.at(-1)?.raw.length
    checks.equal("finish", result.finish, { kind: "stop" })
    checkOneRequest(checks, rig)
    checks.equal(
      "all tools on the wire",
      (rig.peer.last.body.tools as unknown[]).length,
      tools.length,
    )
    checks.equal(
      "the system prompt survives",
      arrayField(rig.peer.last.body, "system").some((block) => block.text === hugeSystem),
      true,
    )
    await checkCleanedUp(checks, rig)
  })
}

function byteSplitCase(): EvalCase {
  return evalCase("byte-split-stream", async (rig, checks, facts) => {
    rig.peer.answer = () => ({
      kind: "split",
      blocks: [THINKING, TEXT, TOOL_CALL],
      stop: "tool_use",
    })
    const result = await call(rig, withTools(firstTurn()))
    facts.seconds = result.seconds
    checks.equal("finish", result.finish, { kind: "tool-calls" })
    checks.equal("text survives split characters", textOf(result), FIXTURE_TEXT)
    checks.equal("thinking", reasoningOf(result), THINKING.thinking)
    checks.equal("tool call arguments", toolCallsOf(result)[0]?.arguments, '{"path":"fixture.txt"}')
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function errorEventCase(type: string, expected: { code: string; status?: number }): EvalCase {
  return evalCase(`stream-error-event-${type}`, async (rig, checks, facts) => {
    const message = `fixture ${type}`
    rig.peer.answer = () => ({ kind: "errorEvent", blocks: [TEXT], error: { type, message } })
    const result = await call(rig, withTools(firstTurn()))
    checks.equal("finish kind", result.finish.kind, "error")
    if (result.finish.kind === "error") {
      const { failure } = result.finish
      facts.failure = failure.message
      checks.equal("failure code", failure.code, expected.code)
      checks.equal("failure status", failure.status, expected.status)
      checks.ok("the upstream's text is the message", failure.message.startsWith(message), failure)
      checks.ok(
        "no denial text from the CLI",
        !failure.message.includes("DSH_MODEL_ADMISSION_CONSUMED"),
        failure,
      )
    }
    withoutRoute(checks, result.finish)
    checkOneRequest(checks, rig)
    await checkCleanedUp(checks, rig)
  })
}

function cancelEarlyCase(): EvalCase {
  return evalCase("cancel-during-replay", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const controller = new AbortController()
    const history = [...firstTurn()]
    for (let turn = 0; turn < 40; turn += 1) {
      history.push(user(`Question ${turn}`), assistant([text(`Answer ${turn}`)]))
    }
    history.push(user("Newest question"))
    const pending = call(rig, { ...withTools(history), signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    const result = await pending
    facts.requests = rig.peer.requests.length
    checks.equal("finish kind", result.finish.kind, "aborted")
    await checkCleanedUp(checks, rig)
  })
}

function slashTextCase(): EvalCase {
  const shielded = (value: string) => ({ type: "text", text: ` ${value}` })
  return evalCase("slash-command-text", async (rig, checks) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const first = await call(rig, withTools([system(SYSTEM_PROMPT), user("/compact now")]))
    checks.equal("first finish", first.finish, { kind: "stop" })
    checks.equal(
      "the first turn reaches the model",
      withoutMarks(wireBlocks(rig.peer.last.body, "user")),
      [shielded("/compact now")],
    )

    const replayed = [system(SYSTEM_PROMPT), user("/compact now"), first.stored, user("/help")]
    const next = await call(rig, withTools(replayed))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal(
      "no CLI text around either turn",
      withoutMarks(wireBlocks(rig.peer.last.body, "user")),
      [shielded("/compact now"), shielded("/help")],
    )

    rig.peer.answer = () => stream([TEXT, TOOL_CALL], "tool_use")
    const third = await call(
      rig,
      withTools([...replayed, next.stored, user("/etc/hosts is broken")]),
    )
    checks.equal("third finish", third.finish, { kind: "tool-calls" })

    rig.peer.answer = () => stream([TEXT], "end_turn")
    const steered = [
      ...replayed,
      next.stored,
      user("/etc/hosts is broken"),
      third.stored,
      toolResult("host_tool_1", "/compact stays inside the result"),
      user("/clear"),
    ]
    const fourth = await call(rig, withTools(steered))
    checks.equal("fourth finish", fourth.finish, { kind: "stop" })
    checks.equal("no warnings", rig.warnings, [])
    checks.equal(
      "the steer after a tool result",
      withoutMarks(messagesOf(rig.peer.last.body).at(-1)?.content),
      [
        {
          type: "tool_result",
          tool_use_id: "host_tool_1",
          content: "/compact stays inside the result",
        },
        shielded("/clear"),
      ],
    )
    checkOneRequest(checks, rig, 4)
    await checkCleanedUp(checks, rig)
  })
}

function whitespaceCase(): EvalCase {
  const padded: NativeBlock = { type: "text", text: "  Padded answer.\n\n" }
  return evalCase("whitespace-text", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([THINKING, padded], "end_turn")
    const first = await call(rig, withTools(firstTurn()))
    checks.equal("finish", first.finish, { kind: "stop" })
    checks.equal("text", textOf(first), padded.text)
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const next = await call(rig, withTools([...firstTurn(), first.stored, user("Next")]))
    checks.equal("second finish", next.finish, { kind: "stop" })
    const replayed = withoutMarks(wireBlocks(rig.peer.last.body, "assistant"))
    facts.replayed = replayed
    checks.equal("replayed unchanged", replayed, [THINKING, padded])
    await checkCleanedUp(checks, rig)
  })
}

function redactedThinkingCase(): EvalCase {
  const redacted: NativeBlock = { type: "redacted_thinking", data: "fixture-redacted-data" }
  return evalCase("redacted-thinking", async (rig, checks) => {
    rig.peer.answer = () => stream([redacted, THINKING, TEXT], "end_turn")
    const first = await call(rig, withTools(firstTurn()))
    checks.equal("finish", first.finish, { kind: "stop" })
    checks.equal(
      "only the visible blocks reach DSH",
      first.assembler.blocks().map((b) => b.type),
      ["reasoning", "text"],
    )
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const next = await call(rig, withTools([...firstTurn(), first.stored, user("Next")]))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal(
      "replayed with the redacted block",
      withoutMarks(wireBlocks(rig.peer.last.body, "assistant")),
      [redacted, THINKING, TEXT],
    )
    await checkCleanedUp(checks, rig)
  })
}

function emptyToolResultCase(): EvalCase {
  return evalCase("empty-tool-result", async (rig, checks) => {
    rig.peer.answer = () => stream([TEXT, TOOL_CALL], "tool_use")
    const first = await call(rig, withTools(firstTurn()))
    checks.equal("first finish", first.finish, { kind: "tool-calls" })

    rig.peer.answer = () => stream([TEXT], "end_turn")
    const history = [...firstTurn(), first.stored, toolResult("host_tool_1", "")]
    const next = await call(rig, withTools(history))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal("no warnings", rig.warnings, [])
    const newest = messagesOf(rig.peer.last.body).at(-1)
    checks.equal("the result as DSH wrote it, empty", withoutMarks(newest?.content), [
      { type: "tool_result", tool_use_id: "host_tool_1", content: "" },
    ])
    checkOneRequest(checks, rig, 2)
    await checkCleanedUp(checks, rig)
  })
}

function parallelAndSteerCase(): EvalCase {
  const second: NativeBlock = { ...TOOL_CALL, id: "host_tool_2", input: { path: "other.txt" } }
  return evalCase("parallel-tools-and-steer", async (rig, checks, facts) => {
    rig.peer.answer = () => stream([THINKING, TOOL_CALL, second], "tool_use")
    const first = await call(rig, withTools(firstTurn()))
    checks.equal("finish", first.finish, { kind: "tool-calls" })
    checks.equal("two calls", toolCallsOf(first).length, 2)

    rig.peer.answer = () => stream([TEXT], "end_turn")
    const results = [
      toolResult("host_tool_1", "first result"),
      toolResult("host_tool_2", "second result", true),
      user("Steer: look at the other file."),
    ]
    const history = [...firstTurn(), first.stored, ...results]
    const next = await call(rig, withTools(history))
    checks.equal("second finish", next.finish, { kind: "stop" })
    checks.equal("no warnings", rig.warnings, [])
    const newest = messagesOf(rig.peer.last.body)
      .filter((message) => message.role === "user")
      .at(-1)
    facts.newestBlocks = newest === undefined ? [] : withoutMarks(newest.content)
    checks.equal("the frame as DSH wrote it", withoutMarks(newest?.content), [
      { type: "tool_result", tool_use_id: "host_tool_1", content: "first result" },
      { type: "tool_result", tool_use_id: "host_tool_2", content: "second result", is_error: true },
      { type: "text", text: "Steer: look at the other file." },
    ])
    checkOneRequest(checks, rig, 2)
    await checkCleanedUp(checks, rig)
  })
}

function developerCase(): EvalCase {
  return evalCase("developer-message", async (rig, checks) => {
    rig.peer.answer = () => stream([TEXT], "end_turn")
    const first = await call(rig, withTools(firstTurn()))
    const history = [
      ...firstTurn(),
      first.stored,
      developer([text("Developer note.")]),
      user("After the note."),
    ]
    const next = await call(rig, withTools(history))
    checks.equal("second finish", next.finish, { kind: "stop" })
    const newest = messagesOf(rig.peer.last.body)
      .filter((message) => message.role === "user")
      .at(-1)
    checks.equal("the note comes as user text", withoutMarks(newest?.content), [
      { type: "text", text: "Developer note." },
      { type: "text", text: "After the note." },
    ])
    await checkCleanedUp(checks, rig)
  })
}

// A real 1x1 PNG, so the CLI has no reason to refuse it.
const PNG_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
)

const IMAGE_PATH = "/eval/store/image.png"

function imageCase(): EvalCase {
  const reader = {
    readImageRequest: async () => ({
      data: PNG_PIXEL,
      mediaType: "image/png" as const,
      width: 1,
      height: 1,
    }),
  }
  const ref = imageRef({ bytes: PNG_PIXEL.length, width: 1, height: 1 })
  return evalCase(
    "image",
    async (rig, checks) => {
      rig.peer.answer = () => stream([TEXT, TOOL_CALL], "tool_use")
      const first = await call(
        rig,
        withTools([system(SYSTEM_PROMPT), user([text("Look at this."), imageBlock(ref)])]),
      )
      checks.equal("finish", first.finish, { kind: "tool-calls" })
      const sent = withoutMarks(messagesOf(rig.peer.last.body)[0]?.content) as NativeBlock[]
      const source = {
        type: "base64",
        media_type: "image/png",
        data: PNG_PIXEL.toString("base64"),
      }
      checks.equal("the first frame's image", sent.at(-1), { type: "image", source })
      checks.ok(
        "the image text names the read-only path",
        String(sent.at(-2)?.text).includes(JSON.stringify(IMAGE_PATH)),
        sent.at(-2),
      )

      rig.peer.answer = () => stream([TEXT], "end_turn")
      const history = [
        system(SYSTEM_PROMPT),
        user([text("Look at this."), imageBlock(ref)]),
        first.stored,
        toolResult("host_tool_1", [text("A result with an image."), imageBlock(ref)]),
      ]
      const next = await call(rig, withTools(history))
      checks.equal("second finish", next.finish, { kind: "stop" })
      checks.equal("no warnings", rig.warnings, [])
      const newest = messagesOf(rig.peer.last.body).at(-1)
      const [result] = (newest?.content ?? []) as NativeBlock[]
      const inner = withoutMarks(result?.content) as NativeBlock[]
      checks.equal("the tool result's image", inner.at(-1), { type: "image", source })
      checkOneRequest(checks, rig, 2)
      await checkCleanedUp(checks, rig)
    },
    { attachments: reader, imageAccess: () => ({ readonlyPath: IMAGE_PATH }) },
  )
}

const CASES: readonly EvalCase[] = [
  finalCase(),
  toolsCase(),
  cutOffCase("max", [TEXT], "max_tokens"),
  cutOffCase("tool-max", [TEXT, TOOL_CALL], "max_tokens"),
  cutOffCase("context", [TEXT], "model_context_window_exceeded"),
  thinkingOnlyCase(),
  refusalCase(),
  httpErrorCase("error-429", 429, errorBody("rate_limit_error", "fixture limit"), {
    code: "RATE_LIMIT",
    message: "fixture limit",
  }),
  httpErrorCase("error-401", 401, errorBody("authentication_error", "fixture auth"), {
    code: "INVALID_CREDENTIAL",
    message: "fixture auth",
  }),
  httpErrorCase("error-402", 402, errorBody("billing_error", "fixture billing"), {
    code: "QUOTA",
    message: "fixture billing",
  }),
  httpErrorCase("error-500", 500, errorBody("api_error", "fixture server"), {
    code: "SERVER",
    message: "fixture server",
  }),
  httpErrorCase("error-529", 529, errorBody("overloaded_error", "fixture overload"), {
    code: "SERVER",
    message: "fixture overload",
  }),
  httpErrorCase("error-400", 400, errorBody("invalid_request_error", "fixture invalid"), {
    code: "UPSTREAM_ERROR",
    message: "fixture invalid",
  }),
  httpErrorCase(
    "error-prompt-too-long",
    400,
    errorBody("invalid_request_error", "prompt is too long: 2 tokens > 1 maximum"),
    { code: "CONTEXT_WINDOW_EXCEEDED", message: "prompt is too long" },
  ),
  cutShortCase("disconnect", stream([TEXT], null)),
  cutShortCase("reset", { kind: "reset", blocks: [TEXT] }),
  cancelCase(),
  outsideToolCase(),
  signedThinkingCase(),
  longToolNameCase(),
  sessionTitleCase(),
  generationCase(
    "effort-high",
    { reasoningEffort: effort("high"), stop: ["FIXTURE_STOP"], temperature: 0.5 },
    {
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      stop_sequences: ["FIXTURE_STOP"],
      temperature: undefined,
    },
    ["--effort", "high"],
  ),
  generationCase(
    "effort-off",
    { model: "claude-sonnet-5", reasoningEffort: effort("off") },
    { thinking: { type: "disabled" }, context_management: { edits: [] } },
  ),
  generationCase(
    "effort-off-mandatory",
    { reasoningEffort: effort("off") },
    { output_config: { effort: "low" } },
    ["--effort", "low"],
  ),
  generationCase(
    "haiku-4-5",
    { model: "claude-haiku-4-5" },
    { model: "claude-haiku-4-5-20251001" },
  ),
  generationCase("unpinned-model", { model: "claude-future-9" }, { model: "claude-future-9" }),
  noSystemCase(),
  largeRequestCase(),
  byteSplitCase(),
  errorEventCase("overloaded_error", { code: "SERVER", status: 529 }),
  errorEventCase("rate_limit_error", { code: "RATE_LIMIT", status: 429 }),
  errorEventCase("api_error", { code: "SERVER", status: 500 }),
  errorEventCase("authentication_error", { code: "INVALID_CREDENTIAL", status: 401 }),
  errorEventCase("invalid_request_error", { code: "UPSTREAM_ERROR", status: 400 }),
  errorEventCase("future_error", { code: "TRANSPORT" }),
  emptyToolResultCase(),
  cancelEarlyCase(),
  slashTextCase(),
  whitespaceCase(),
  redactedThinkingCase(),
  parallelAndSteerCase(),
  developerCase(),
  imageCase(),
]

function main(): Promise<never> {
  if (process.argv[2] === undefined) throw new Error("usage: admission.ts /path/to/claude")
  const before = binaryReceipt(binary)
  console.log(JSON.stringify({ ...before, syntheticPeer: true }))
  const untouched: EvalCase = {
    name: "binary-unchanged",
    run: async (checks) => {
      checks.equal("sha256", binaryReceipt(binary).sha256, before.sha256)
    },
  }
  return runEval("admission", [...CASES, untouched])
}

await main()
