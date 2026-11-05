/**
 * The real `claude` binary and the real plugin code against a synthetic loopback peer. It checks
 * exact cached-prefix reuse across the requests of one conversation, not cache hit rates: the
 * usage it answers is made up. Only hashes and compact facts go to stdout, unless `--dump <dir>`
 * asks for the synthetic requests as files.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import type { RequestMessage, ToolSchema } from "@deepseek-ai/dsh-llm"
import type { JsonObject, NativeBlock } from "../src/contract"
import {
  dropMessageBreakpoints,
  pinMessageBreakpoint,
  QueriedTurnMismatch,
  restoreQueriedTurn,
  stableRequestContext,
  streamToolInput,
} from "../src/relay/rewrite"
import { assistant, system, text, toolResult, user } from "../test/support/messages"
import { type Checks, type Facts, runEval } from "./support/check"
import { type Call, call, MODEL, requestOf, toolCallsOf } from "./support/conversation"
import { USAGE } from "./support/peer"
import { binaryReceipt, openRig, type Rig } from "./support/rig"
import {
  allMarks,
  arrayField,
  blocksOf,
  cutAt,
  digest,
  firstDifference,
  messageMarks,
  messagesOf,
  type Position,
  type Prompt,
  promptOf,
  serialized,
  type WireMessage,
  withoutMarks,
} from "./support/wire"

const THINKING: NativeBlock = {
  type: "thinking",
  thinking: "PUBLIC SYNTHETIC THINKING",
  signature: "public-fixture-opaque-signature",
}
const PROBE: ToolSchema = {
  name: "probe",
  description: "Public probe",
  parameters: { type: "object", properties: {} },
}
// A pure tool continuation, two ordinary user turns, a 14-round loop with thinking, and the turn
// after that loop.
const SCHEDULE: readonly boolean[] = [
  true,
  true,
  false,
  false,
  ...Array(14).fill(true),
  false,
  true,
]
const LOOKBACK = 20
const MARK_LIMIT = 4
const SIGNED_THINKING_ROUNDS = new Set([1, 2, 5])
const EARLIER_TURNS = 12
const SYSTEM_TEXT = "PUBLIC SYNTHETIC SYSTEM\n".repeat(300)
const TOOL_OUTPUT = "Public tool result\n".repeat(1000)
const DATE_LINE = /Today's date is [0-9]{4}-[0-9]{2}-[0-9]{2}\./

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { dump: { type: "string" }, model: { type: "string", default: MODEL } },
})
const binaryArgument = positionals[0]
if (binaryArgument === undefined) throw new Error("usage: cache-wire.ts /path/to/claude")
const binary = resolve(binaryArgument)
const model = flags.model as string

function earlierHistory(): RequestMessage[] {
  const turns: RequestMessage[] = [system(SYSTEM_TEXT)]
  for (let turn = 0; turn < EARLIER_TURNS; turn += 1) {
    turns.push(
      user(`Public earlier question ${turn}`),
      assistant([text(`Public earlier answer ${turn}`)], undefined, model),
    )
  }
  turns.push(user("Run the public probe."))
  return turns
}

function toolAnswer(number: number, body: JsonObject): NativeBlock[] {
  const [tool] = arrayField(body, "tools")
  return [THINKING, { type: "tool_use", id: `toolu_public_${number}`, name: tool?.name, input: {} }]
}

interface RewriteTrace {
  dropped: boolean
  restored: boolean | string
  stabilized: boolean
  pinned: boolean
  flagged: boolean
  final: Buffer
}

function restoreStep(payload: Buffer, queried: readonly NativeBlock[]): Buffer | string {
  try {
    return restoreQueriedTurn(payload, queried)
  } catch (error) {
    if (error instanceof QueriedTurnMismatch) return error.message
    throw error
  }
}

/** The relay's rewrites, one by one on what the CLI sent, to show which of them found anything. */
function traceRewrites(
  raw: Buffer,
  queried: readonly NativeBlock[],
  oneShot: boolean,
): RewriteTrace {
  const start = oneShot ? dropMessageBreakpoints(raw) : raw
  const restoreResult = restoreStep(start, queried)
  const restored = typeof restoreResult === "string" ? start : restoreResult
  const stable = stableRequestContext(restored, queried)
  const pinned = pinMessageBreakpoint(stable, queried)
  const final = streamToolInput(pinned)
  return {
    dropped: start !== raw,
    restored: typeof restoreResult === "string" ? restoreResult : restored !== start,
    stabilized: stable !== restored,
    pinned: pinned !== stable,
    flagged: final !== pinned,
    final,
  }
}

function textsBeforeFrame(raw: JsonObject): number {
  const newest = messagesOf(raw)
    .filter((message) => message.role === "user")
    .at(-1)
  if (newest === undefined || typeof newest.content === "string") return 0
  const first = newest.content.findIndex(
    (block) => block.type !== "text" || !String(block.text).startsWith("<system-reminder>"),
  )
  return first < 0 ? newest.content.length : first
}

function dateLinePlace(raw: JsonObject): string[] {
  return messagesOf(raw).flatMap((message, index) =>
    blocksOf(message).some((block) => typeof block.text === "string" && DATE_LINE.test(block.text))
      ? [`messages[${index}].${message.role}`]
      : [],
  )
}

function shapeOf(message: WireMessage | undefined): unknown {
  if (message === undefined) return null
  return {
    role: message.role,
    blocks: blocksOf(message).map((block) => ({
      type: block.type,
      chars: JSON.stringify(block).length,
      ...(Object.hasOwn(block, "cache_control") ? { marked: true } : {}),
    })),
  }
}

/** What the CLI put on the wire by itself, before any rewrite. */
function rawFacts(raw: JsonObject): JsonObject {
  const messages = messagesOf(raw)
  return {
    marks: allMarks(raw).length,
    systemMarks: allMarks(raw.system).length,
    toolMarks: allMarks(raw.tools).length,
    messageMarks: messageMarks(raw),
    roles: messages.map((message) => message.role).join(","),
    dateLine: dateLinePlace(raw),
    newest: shapeOf(messages.at(-1)),
    remindersBeforeFrame: textsBeforeFrame(raw),
    eagerFlag: arrayField(raw, "tools").map((tool) => tool.eager_input_streaming ?? null),
    systemBlocks: arrayField(raw, "system").map((block) => String(block.text).length),
  }
}

function checkMarks(checks: Checks, round: number, wire: JsonObject, marks: Position[]): void {
  const every = allMarks(wire)
  checks.ok(
    `round ${round}: at most ${MARK_LIMIT} cache marks`,
    every.length <= MARK_LIMIT,
    every.length,
  )
  checks.ok(
    `round ${round}: one or two message marks`,
    marks.length >= 1 && marks.length <= 2,
    marks,
  )
  checks.ok(
    `round ${round}: one cache TTL`,
    every.every((mark) => serialized(mark) === serialized(every[0])),
    every,
  )
}

function fixedMarks(wire: JsonObject): unknown[] {
  return [...arrayField(wire, "tools"), ...arrayField(wire, "system")].map(
    (block) => block.cache_control ?? null,
  )
}

interface PreviousRequest {
  prefix: Prompt
  at: Position
  fixed: unknown[]
}

function checkPrefix(
  checks: Checks,
  round: number,
  prompt: Prompt,
  fixed: unknown[],
  previous: PreviousRequest,
): JsonObject {
  const candidate = cutAt(prompt, previous.at)
  const same = serialized(candidate) === serialized(previous.prefix)
  checks.ok(
    `round ${round}: the cached prefix came back byte for byte`,
    same,
    firstDifference(previous.prefix, candidate),
  )
  checks.equal(`round ${round}: marks on tools and system`, fixed, previous.fixed)
  return { round, previous: digest(previous.prefix), replayed: digest(candidate) }
}

function positionsBetween(wire: JsonObject, first: Position, last: Position): number {
  const blockCount = messagesOf(wire)
    .slice(first.message, last.message)
    .reduce((sum, message) => sum + blocksOf(message).length, 0)
  return blockCount - first.block + last.block + 1
}

function checkTurnMark(
  checks: Checks,
  facts: Facts,
  wire: JsonObject,
  prompt: Prompt,
  marks: Position[],
  written: ReadonlySet<string>,
  openingFrameText: string,
): void {
  const messages = messagesOf(wire)
  const opening = messages.findIndex(
    (message) =>
      message.role === "user" &&
      serialized(withoutMarks(message.content)).includes(serialized(openingFrameText)),
  )
  const [first] = marks
  const last = marks.at(-1)
  checks.equal("the turn mark sits on the loop's opening frame", first?.message, opening)
  checks.equal("two message marks after the long loop", marks.length, 2)
  if (first === undefined || last === undefined) return
  const span = positionsBetween(wire, first, last)
  checks.ok(`the marks are further apart than ${LOOKBACK} positions`, span > LOOKBACK, span)
  checks.ok("the turn mark covers a written prefix", written.has(digest(cutAt(prompt, first))))
  facts.turnMark = { at: first, positionsToRecurring: span }
}

interface RoundState {
  previous: PreviousRequest | undefined
  written: Set<string>
  followups: string[]
  history: RequestMessage[]
  receipts: JsonObject[]
  rawRounds: JsonObject[]
  rewrites: JsonObject[]
  sessions: Set<string>
}

function dump(directory: string | undefined, name: string, raw: Buffer): void {
  if (directory === undefined) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name), raw)
}

/** Compares the relay's real output with the rewrites run one by one on the CLI's bytes. */
function traceRequest(checks: Checks, rig: Rig, state: RoundState, round: number): void {
  const entry = rig.relays.at(-1)
  const raw = rig.tapped.messages.at(-1)
  if (entry === undefined || raw === undefined) {
    checks.ok(`round ${round}: the tap saw the request`, false)
    return
  }
  const trace = traceRewrites(raw, entry.options.queried, entry.options.oneShot)
  const { final, ...found } = trace
  checks.ok(
    `round ${round}: the relay sent what its rewrites produce`,
    final.equals(rig.peer.last.raw),
  )
  checks.equal(
    `round ${round}: relay reports the same restore`,
    entry.relay.unrestored,
    typeof trace.restored === "string" ? trace.restored : null,
  )
  state.rewrites.push({ round, ...found })
  state.rawRounds.push({ round, ...rawFacts(JSON.parse(raw.toString("utf8")) as JsonObject) })
  dump(flags.dump, `round-${round}-raw.json`, raw)
  dump(flags.dump, `round-${round}-wire.json`, rig.peer.last.raw)
}

function sessionOf(rig: Rig): string {
  const header = rig.peer.last.headers["x-claude-code-session-id"]
  return typeof header === "string" ? header : "absent"
}

async function runRound(
  rig: Rig,
  checks: Checks,
  facts: Facts,
  state: RoundState,
  round: number,
): Promise<void> {
  const tools = SCHEDULE[round] === true
  const number = rig.peer.requests.length + 1
  rig.peer.answer = (request) => ({
    kind: "stream",
    blocks: tools
      ? toolAnswer(number, request.body)
      : [{ type: "text", text: "PUBLIC SYNTHETIC ANSWER" }],
    stop: tools ? "tool_use" : "end_turn",
  })
  const before = serialized(state.history)
  const start = rig.peer.requests.length
  const result = await call(rig, requestOf(state.history, { model, tools: [PROBE] }))
  checks.equal(
    `round ${round}: the caller's history stayed as it was`,
    serialized(state.history) === before,
    true,
  )
  checks.equal(`round ${round}: one upstream request`, rig.peer.requests.length, start + 1)
  checks.equal(`round ${round}: finish`, result.finish, { kind: tools ? "tool-calls" : "stop" })
  traceRequest(checks, rig, state, round)
  state.sessions.add(sessionOf(rig))

  const wire = rig.peer.last.body
  const marks = messageMarks(wire)
  checkMarks(checks, round, wire, marks)
  const prompt = promptOf(wire)
  const fixed = fixedMarks(wire)
  const newestMark = marks.at(-1)
  if (state.previous !== undefined) {
    state.receipts.push(checkPrefix(checks, round, prompt, fixed, state.previous))
  }
  if (round === SCHEDULE.length - 1) {
    checkTurnMark(checks, facts, wire, prompt, marks, state.written, state.followups.at(-2) ?? "")
  }
  for (const at of marks) state.written.add(digest(cutAt(prompt, at)))
  if (newestMark !== undefined) {
    state.previous = { prefix: cutAt(prompt, newestMark), at: newestMark, fixed }
  }
  if (SIGNED_THINKING_ROUNDS.has(round)) {
    checks.ok(
      `round ${round}: signed thinking reached the peer unchanged`,
      serialized(prompt.messages).includes(serialized(THINKING)),
    )
  }
  appendAnswer(state, round, result)
}

function appendAnswer(state: RoundState, round: number, result: Call): void {
  state.history.push(result.stored)
  const calls = toolCallsOf(result)
  if (calls.length > 0) {
    state.history.push(...calls.map((block) => toolResult(block.id, TOOL_OUTPUT)))
    return
  }
  const followup = `Public followup ${round}`
  state.followups.push(followup)
  state.history.push(user(followup))
}

async function runConversation(rig: Rig, checks: Checks, facts: Facts): Promise<void> {
  const state: RoundState = {
    previous: undefined,
    written: new Set(),
    followups: [],
    history: earlierHistory(),
    receipts: [],
    rawRounds: [],
    rewrites: [],
    sessions: new Set(),
  }
  for (let round = 0; round < SCHEDULE.length; round += 1) {
    await runRound(rig, checks, facts, state, round)
  }
  const [first] = rig.peer.requests
  if (first !== undefined) {
    const count = messagesOf(first.body).reduce((sum, message) => sum + blocksOf(message).length, 0)
    checks.ok(`the first request is past the ${LOOKBACK} block lookback`, count > LOOKBACK, count)
  }
  checks.equal("one session id for the conversation", state.sessions.size, 1)
  checks.ok("the session header is present", !state.sessions.has("absent"))
  const midHistory = messagesOf(rig.peer.last.body).flatMap((message, index) =>
    message.role === "system" && index > 1 ? [{ index, text: blocksOf(message)[0]?.text }] : [],
  )
  facts.cliSystemTextInHistory = midHistory
  checks.ok(
    "the CLI's budget reminder stays out",
    rig.peer.requests.every((request) => !request.raw.includes("<total_tokens>")),
  )
  checks.equal("no warnings from the adapter", rig.warnings, [])
  checks.equal("no other request at the peer", rig.peer.others, [])
  facts.requests = rig.peer.requests.length
  facts.syntheticUsage = USAGE
  facts.prefixReceipts = state.receipts.length
  facts.lastReceipt = state.receipts.at(-1)
  facts.cliOtherRequests = [...new Set(rig.tapped.others.map(withoutPrivateRoute))]
  facts.rewrites = state.rewrites
  facts.rawRounds = state.rawRounds
}

function environmentOf(wire: JsonObject): unknown {
  const [message] = messagesOf(wire).filter((candidate) => candidate.role === "system")
  return message === undefined ? undefined : blocksOf(message)[0]?.text
}

/** The first turns of a new conversation: the CLI's opening request has its own shape. */
async function runFreshConversation(rig: Rig, checks: Checks, facts: Facts): Promise<void> {
  const history: RequestMessage[] = [system(SYSTEM_TEXT), user("Run the public probe.")]
  const environments: unknown[] = []
  const scripts = [true, true, false, false]
  let previous: PreviousRequest | undefined
  for (const [round, tools] of scripts.entries()) {
    const number = rig.peer.requests.length + 1
    rig.peer.answer = (request) => ({
      kind: "stream",
      blocks: tools
        ? toolAnswer(number, request.body)
        : [{ type: "text", text: "PUBLIC SYNTHETIC ANSWER" }],
      stop: tools ? "tool_use" : "end_turn",
    })
    const result = await call(rig, requestOf(history, { model, tools: [PROBE] }))
    checks.equal(`round ${round}: finish`, result.finish, { kind: tools ? "tool-calls" : "stop" })
    const wire = rig.peer.last.body
    const marks = messageMarks(wire)
    checkMarks(checks, round, wire, marks)
    const prompt = promptOf(wire)
    const fixed = fixedMarks(wire)
    if (previous !== undefined) checkPrefix(checks, round, prompt, fixed, previous)
    const newest = marks.at(-1)
    if (newest !== undefined) previous = { prefix: cutAt(prompt, newest), at: newest, fixed }
    environments.push(environmentOf(wire))
    history.push(result.stored)
    const calls = toolCallsOf(result)
    if (calls.length > 0) history.push(...calls.map((block) => toolResult(block.id, TOOL_OUTPUT)))
    else history.push(user(`Public followup ${round}`))
  }
  // The opening request holds this text in one block and later ones in a string. No written prefix
  // covers it in block form, because the opening mark sits on the turn before it.
  checks.equal("the environment text never changes", new Set(environments).size, 1)
  const raw = rig.tapped.messages[0]
  if (raw !== undefined) {
    facts.openingRequest = rawFacts(JSON.parse(raw.toString("utf8")) as JsonObject)
  }
  checks.equal("no warnings from the adapter", rig.warnings, [])
}

function withoutPrivateRoute(line: string): string {
  return line.replace(/\/admit\/[^/\s?]+/, "/admit/<route>")
}

async function runOneShots(rig: Rig, checks: Checks, facts: Facts): Promise<void> {
  rig.peer.answer = () => ({
    kind: "stream",
    blocks: [{ type: "text", text: "PUBLIC SYNTHETIC ANSWER" }],
    stop: "end_turn",
  })
  const turn = [
    system("PUBLIC SUMMARY POLICY\n".repeat(50)),
    user("Public transcript.\n".repeat(200)),
  ]

  await call(rig, requestOf(turn, { model }))
  checks.ok(
    "a tool-free chat turn keeps its message mark",
    messageMarks(rig.peer.last.body).length > 0,
    allMarks(rig.peer.last.body),
  )

  const start = rig.peer.requests.length
  await call(rig, requestOf(turn, { model, purpose: "compaction" }))
  checks.equal("one upstream request", rig.peer.requests.length, start + 1)
  const wire = rig.peer.last.body
  const systemMarks = allMarks(wire.system)
  checks.equal("a one-shot has no message mark", messageMarks(wire), [])
  checks.ok("a one-shot keeps its system marks", systemMarks.length > 0, wire.system)
  const entry = rig.relays.at(-1)
  const raw = rig.tapped.messages.at(-1)
  if (entry !== undefined && raw !== undefined) {
    const { final: _final, ...found } = traceRewrites(
      raw,
      entry.options.queried,
      entry.options.oneShot,
    )
    facts.rewrites = found
    facts.raw = rawFacts(JSON.parse(raw.toString("utf8")) as JsonObject)
  }
  facts.oneShot = { messageMarks: 0, systemMarks }
}

const before = binaryReceipt(binary)
console.log(JSON.stringify({ ...before, model, syntheticUsageNotACacheMeasurement: true }))

async function withRig(run: (rig: Rig) => Promise<void>): Promise<void> {
  const rig = await openRig({ binary, tap: true })
  try {
    await run(rig)
  } finally {
    await rig.close()
  }
}

await runEval("cache-wire", [
  {
    name: "conversation",
    run: (checks, facts) => withRig((rig) => runConversation(rig, checks, facts)),
  },
  {
    name: "fresh-conversation",
    run: (checks, facts) => withRig((rig) => runFreshConversation(rig, checks, facts)),
  },
  {
    name: "one-shots",
    run: (checks, facts) => withRig((rig) => runOneShots(rig, checks, facts)),
  },
  {
    name: "binary-unchanged",
    run: async (checks) => checks.equal("sha256", binaryReceipt(binary).sha256, before.sha256),
  },
])
