import type { JsonObject, NativeBlock } from "../../contract"
import {
  countMarks,
  dropLeadingText,
  hasMark,
  isCacheable,
  isUncacheable,
  leadingLength,
  setMarkIfAbsent,
  takeMark,
  withoutMark,
} from "./blocks"
import {
  isObject,
  jsonEqual,
  lastAssistantIndex,
  parseJsonObject,
  readMessages,
  serializeBody,
} from "./payload"

// Anthropic's cache lookup checks at most this many positions back from a breakpoint, the
// breakpoint itself included. A request may carry at most MAX_BREAKPOINTS breakpoints in total
// across tools, system and messages.
const LOOKBACK = 20
const MAX_BREAKPOINTS = 4

interface Position {
  message: number
  index: number
}

interface PlacedBlock extends Position {
  block: JsonObject
}

function isBefore(left: Position, right: Position): boolean {
  return (
    left.message < right.message || (left.message === right.message && left.index < right.index)
  )
}

/** Every object block of every message, in request order, with its position. */
function placedBlocks(messages: readonly JsonObject[]): PlacedBlock[] {
  return messages.flatMap((message, messageIndex) =>
    Array.isArray(message.content)
      ? message.content.flatMap((block, index) =>
          isObject(block) ? [{ message: messageIndex, index, block }] : [],
        )
      : [],
  )
}

function markedBlocks(messages: readonly JsonObject[]): PlacedBlock[] {
  return placedBlocks(messages).filter(({ block }) => hasMark(block))
}

function lastCacheable(blocks: readonly PlacedBlock[]): PlacedBlock | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const placed = blocks[index]
    if (placed !== undefined && isCacheable(placed.block)) return placed
  }
  return undefined
}

/**
 * On the opening request the CLI puts its per-request context before the frame DSH queried.
 * Later requests replay that turn without it, so the opening turn is sent bare too. Only the
 * conversation's first turn changes, and only when the frame occurs exactly once.
 */
function dropOpeningContext(
  messages: readonly JsonObject[],
  queried: readonly NativeBlock[],
): boolean {
  if (messages.some((message) => message.role === "assistant")) return false
  const first = messages.find((message) => message.role === "user")
  if (first === undefined || !Array.isArray(first.content)) return false
  const count = leadingLength(first.content, queried)
  return count > 0 && dropLeadingText(first.content, count)
}

/**
 * The leading blocks of the newest user turn that equal the queried frame. They recur in the
 * next request. When a tool result follows them, none are pinned: a mark on unchanged results
 * before a changed one measured no cache hit, even though they replay byte for byte.
 */
function queriedPrefix(
  messages: readonly JsonObject[],
  turn: number,
  queried: readonly NativeBlock[],
): PlacedBlock[] {
  const newest = messages[turn]
  if (newest?.role !== "user" || !Array.isArray(newest.content)) return []
  const prefix: PlacedBlock[] = []
  for (let index = 0; index < Math.min(newest.content.length, queried.length); index += 1) {
    const sent: unknown = newest.content[index]
    if (!isObject(sent) || !jsonEqual(withoutMark(sent), withoutMark(queried[index]))) break
    prefix.push({ message: turn, index, block: sent })
  }
  const next: unknown = newest.content[prefix.length]
  return isObject(next) && next.type === "tool_result" ? [] : prefix
}

/** Moves every mark after `target` onto it. The earliest of them wins, unless `target` has its own. */
function foldMarks(target: PlacedBlock, later: readonly PlacedBlock[]): void {
  const [moved] = later.map(({ block }) => takeMark(block))
  setMarkIfAbsent(target.block, moved)
}

/** A user message that carries more than tool results: a new turn, or a steer row after results. */
function opensTurn(message: JsonObject): boolean {
  if (message.role !== "user") return false
  const { content } = message
  if (typeof content === "string") return true
  return (
    Array.isArray(content) &&
    content.some((block) => !isObject(block) || block.type !== "tool_result")
  )
}

function holdsThinking(message: JsonObject): boolean {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some(isUncacheable)
  )
}

function lastIndexWhere<T>(
  items: readonly T[],
  from: number,
  test: (item: T) => boolean,
): number | undefined {
  for (let index = from; index >= 0; index -= 1) {
    if (test(items[index] as T)) return index
  }
  return undefined
}

function firstIndexWhere<T>(
  items: readonly T[],
  from: number,
  to: number,
  test: (item: T) => boolean,
): number | undefined {
  for (let index = from; index <= to; index += 1) {
    if (test(items[index] as T)) return index
  }
  return undefined
}

function countBlocks(messages: readonly JsonObject[]): number {
  return messages.reduce(
    (sum, message) => sum + (Array.isArray(message.content) ? message.content.length : 1),
    0,
  )
}

/**
 * The last cacheable block of the user message just before the open turn's first assistant
 * message with thinking. The open turn starts at the latest user message that carries more than
 * tool results before the last assistant message.
 */
function turnStartSpot(
  messages: readonly JsonObject[],
  lastAssistant: number,
): PlacedBlock | undefined {
  const opening = lastIndexWhere(messages, lastAssistant - 1, opensTurn)
  if (opening === undefined) return undefined
  const thought = firstIndexWhere(messages, opening + 1, lastAssistant, holdsThinking)
  if (thought === undefined) return undefined
  const frame = lastIndexWhere(messages, thought - 1, (message) => message.role === "user")
  const content = frame === undefined ? undefined : messages[frame]?.content
  if (frame === undefined || !Array.isArray(content)) return undefined
  const index = lastIndexWhere(
    content,
    content.length - 1,
    (block) => isObject(block) && isCacheable(block),
  )
  const block: unknown = index === undefined ? undefined : content[index]
  return index !== undefined && isObject(block) ? { message: frame, index, block } : undefined
}

/**
 * Keeps a breakpoint where the open turn's thinking starts, so the next turn can still read it.
 *
 * Once a user message carries more than tool results, the cache entries written after the open
 * turn's first thinking block stop matching. The lookup walks back at most LOOKBACK positions
 * from a breakpoint, so after a long tool loop the recurring breakpoint cannot reach the last
 * entry written before that block, and the whole conversation is written again. The block gets
 * a mark of its own, with the TTL of the next mark after it.
 *
 * The mark is added only while the request stays within MAX_BREAKPOINTS. At the limit, a native
 * mark between it and `target` moves there instead, and otherwise nothing changes.
 */
function keepTurnMark(
  body: JsonObject,
  messages: readonly JsonObject[],
  lastAssistant: number,
  target: PlacedBlock,
): boolean {
  const spot = turnStartSpot(messages, lastAssistant)
  if (spot === undefined || hasMark(spot.block) || !isBefore(spot, target)) return false

  // Distance is counted per block. The API merges runs of tool_use and tool_result blocks, so
  // this can only mark early.
  const span = countBlocks(messages.slice(spot.message, target.message))
  if (span - spot.index + target.index + 1 <= LOOKBACK) return false

  const later = markedBlocks(messages).filter((marked) => isBefore(spot, marked))
  const [firstLater] = later
  if (firstLater === undefined) return false
  if (countMarks(body) < MAX_BREAKPOINTS) {
    spot.block.cache_control = structuredClone(firstLater.block.cache_control)
    return true
  }
  const spare = later.find((marked) => isBefore(marked, target))
  if (spare === undefined || !hasMark(target.block)) return false
  spot.block.cache_control = takeMark(spare.block)
  return true
}

/**
 * Keeps the recurring message mark on content that the next request replays unchanged.
 *
 * The CLI attaches per-request context to the turn it answers and puts the message mark on or
 * after it. The next request replays that turn without the context, so the cached prefix would
 * never recur and every tool round would write the whole history again.
 *
 * What recurs is known without reading the CLI's text: everything through the last assistant
 * message, plus the leading blocks of the newest turn that equal the frame DSH queried. The mark
 * goes on the last cacheable block of that span. Marks after the span never recur, so they fold
 * into that one. After a tool loop longer than the lookback, one more mark keeps the open turn's
 * start readable. System and tools marks are never touched, and the count of marks grows by at
 * most one, within the limit of four.
 *
 * A mark never moves later. The only content change is the CLI's context on the opening turn.
 * A payload that does not parse, or that has nothing to anchor on, returns unchanged.
 */
export function pinMessageBreakpoint(payload: Buffer, queried: readonly NativeBlock[]): Buffer {
  if (queried.length === 0) return payload
  const body = parseJsonObject(payload)
  const messages = body === undefined ? undefined : readMessages(body)
  if (body === undefined || messages === undefined) return payload

  const trimmedOpening = dropOpeningContext(messages, queried)
  const marked = markedBlocks(messages)
  if (marked.length === 0 && !trimmedOpening) return payload

  const lastAssistant = lastAssistantIndex(messages)
  const recurring = [
    ...placedBlocks(messages).filter(({ message }) => message <= lastAssistant),
    ...queriedPrefix(messages, lastAssistant + 1, queried),
  ]
  const target = lastCacheable(recurring)
  const later = target === undefined ? [] : marked.filter((mark) => isBefore(target, mark))
  const folded = target !== undefined && later.length > 0
  if (folded) foldMarks(target, later)
  const pinnedTurn = target !== undefined && keepTurnMark(body, messages, lastAssistant, target)

  return trimmedOpening || folded || pinnedTurn ? serializeBody(body) : payload
}

/**
 * Removes the message marks from a request that nothing replays. System and tools marks stay,
 * so a stable system prompt is still cached across such calls.
 */
export function dropMessageBreakpoints(payload: Buffer): Buffer {
  const body = parseJsonObject(payload)
  const messages = body === undefined ? undefined : readMessages(body)
  if (body === undefined || messages === undefined) return payload
  let dropped = false
  for (const { content } of messages) {
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isObject(block)) continue
      const mark = takeMark(block)
      if (mark !== undefined && mark !== null) dropped = true
    }
  }
  return dropped ? serializeBody(body) : payload
}
