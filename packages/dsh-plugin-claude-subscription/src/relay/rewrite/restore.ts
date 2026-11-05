import type { JsonObject, NativeBlock } from "../../contract"
import { hasMark, withoutMark } from "./blocks"
import {
  isObject,
  jsonEqual,
  lastAssistantIndex,
  parseJsonObject,
  readMessages,
  serializeBody,
} from "./payload"

export const QUERIED_TURN_MISMATCH = "Native request does not uniquely match the DSH tool results"

/** The CLI's newest turn cannot be proven to be the frame DSH asked it to query. */
export class QueriedTurnMismatch extends Error {
  constructor() {
    super(QUERIED_TURN_MISMATCH)
    this.name = "QueriedTurnMismatch"
  }
}

const IGNORED_RESULT_KEYS: ReadonlySet<string> = new Set(["content", "is_error", "cache_control"])

interface BareText extends JsonObject {
  type: "text"
  text: string
}

function isToolResult(block: unknown): block is JsonObject {
  return isObject(block) && block.type === "tool_result"
}

function isBareText(block: unknown): block is BareText {
  return (
    isObject(block) &&
    block.type === "text" &&
    typeof block.text === "string" &&
    Object.keys(block).length === 2
  )
}

function joinText(blocks: readonly BareText[]): string {
  return blocks.map((block) => block.text).join("")
}

function leadingBareText(blocks: readonly unknown[], start: number): BareText[] {
  const run: BareText[] = []
  for (let index = start; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!isBareText(block)) break
    run.push(block)
  }
  return run
}

function without(block: JsonObject, keys: ReadonlySet<string>): JsonObject {
  return Object.fromEntries(Object.entries(block).filter(([key]) => !keys.has(key)))
}

/** Text of a string or of a list made only of bare text blocks. Undefined for anything else. */
function flatText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value) && value.every(isBareText)) return joinText(value)
  return undefined
}

function errorFlag(block: JsonObject): unknown {
  return Object.hasOwn(block, "is_error") ? block.is_error : false
}

function restoreContent(sent: unknown, host: unknown): unknown {
  if (typeof host === "string" || typeof sent === "string") {
    const sentText = flatText(sent)
    const hostText = flatText(host)
    if (sentText === undefined || hostText === undefined || !sentText.startsWith(hostText)) {
      throw new QueriedTurnMismatch()
    }
    return structuredClone(host)
  }
  if (Array.isArray(sent) && Array.isArray(host)) return restoreSequence(sent, host)
  if (!jsonEqual(sent, host)) throw new QueriedTurnMismatch()
  return structuredClone(host)
}

function restoreToolResult(sent: JsonObject, host: JsonObject, restored: JsonObject): void {
  const sentError = errorFlag(sent)
  const hostError = errorFlag(host)
  if (typeof sentError !== "boolean" || typeof hostError !== "boolean" || sentError !== hostError) {
    throw new QueriedTurnMismatch()
  }
  if (!jsonEqual(without(sent, IGNORED_RESULT_KEYS), without(host, IGNORED_RESULT_KEYS))) {
    throw new QueriedTurnMismatch()
  }
  if (Object.hasOwn(sent, "content") !== Object.hasOwn(host, "content")) {
    throw new QueriedTurnMismatch()
  }
  if (Object.hasOwn(host, "content")) restored.content = restoreContent(sent.content, host.content)
}

function restoreBlock(sent: unknown, host: unknown): JsonObject {
  if (!isObject(sent) || !isObject(host)) throw new QueriedTurnMismatch()
  const restored = structuredClone(host)
  if (host.type === "tool_result") {
    restoreToolResult(sent, host, restored)
  } else if (!jsonEqual(withoutMark(sent), withoutMark(host))) {
    throw new QueriedTurnMismatch()
  }
  if (hasMark(sent)) {
    if (hasMark(host) && !jsonEqual(sent.cache_control, host.cache_control)) {
      throw new QueriedTurnMismatch()
    }
    restored.cache_control = structuredClone(sent.cache_control)
  }
  return restored
}

/**
 * Walks the host blocks and the blocks native sent. Runs of bare text on both sides compare as
 * one text, so a split run matches. Native may only append bare text after the last host block.
 */
function restoreSequence(sent: readonly unknown[], host: readonly unknown[]): unknown[] {
  const restored: unknown[] = []
  let hostAt = 0
  let sentAt = 0
  while (hostAt < host.length) {
    if (sentAt >= sent.length) throw new QueriedTurnMismatch()
    const hostRun = leadingBareText(host, hostAt)
    const sentRun = leadingBareText(sent, sentAt)
    if (hostRun.length > 0 && sentRun.length > 0) {
      const original = joinText(hostRun)
      const actual = joinText(sentRun)
      const reachesEnd = hostAt + hostRun.length === host.length
      // An extension before a protected host block is an insertion, not a suffix.
      if (!(reachesEnd ? actual.startsWith(original) : actual === original)) {
        throw new QueriedTurnMismatch()
      }
      restored.push(...structuredClone(hostRun))
      hostAt += hostRun.length
      sentAt += sentRun.length
    } else {
      restored.push(restoreBlock(sent[sentAt], host[hostAt]))
      hostAt += 1
      sentAt += 1
    }
  }
  if (!sent.slice(sentAt).every(isBareText)) throw new QueriedTurnMismatch()
  return restored
}

function resultIds(blocks: readonly unknown[]): unknown[] {
  return blocks.filter(isToolResult).map((block) => block.tool_use_id)
}

function assertSameResultIds(native: readonly unknown[], queried: readonly NativeBlock[]): void {
  const queriedIds = resultIds(queried)
  const usable = queriedIds.every((id) => typeof id === "string" && id !== "")
  if (!usable || new Set(queriedIds).size !== queriedIds.length) throw new QueriedTurnMismatch()
  if (!jsonEqual(queriedIds, resultIds(native))) throw new QueriedTurnMismatch()
}

/**
 * Puts the frame DSH queried back in place of native's newest turn, when it can prove native
 * only added to it. Native appends reminders and context to tool results, and the next request
 * replays them without those additions.
 *
 * The result ids anchor the frame. Only trailing bare text may be dropped, and nothing that
 * carries media, metadata or a cache mark. A frame with no tool result is outside this scope
 * and returns unchanged.
 *
 * @throws QueriedTurnMismatch when native's turn cannot be matched to the queried frame.
 */
export function restoreQueriedTurn(payload: Buffer, queried: readonly NativeBlock[]): Buffer {
  if (!queried.some(isToolResult)) return payload
  const body = parseJsonObject(payload)
  const messages = body === undefined ? undefined : readMessages(body)
  if (body === undefined || messages === undefined) throw new QueriedTurnMismatch()
  const newest = messages.at(lastAssistantIndex(messages) + 1)
  const native = newest?.role === "user" ? newest.content : undefined
  if (newest === undefined || !Array.isArray(native)) throw new QueriedTurnMismatch()
  assertSameResultIds(native, queried)
  const restored = restoreSequence(native, queried)
  if (jsonEqual(native, restored)) return payload
  newest.content = restored
  return serializeBody(body)
}
