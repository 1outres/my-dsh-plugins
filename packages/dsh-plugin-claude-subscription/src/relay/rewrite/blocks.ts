import type { JsonObject } from "../../contract"
import { isObject, jsonEqual } from "./payload"

const MARK = "cache_control"
const PLAIN_TEXT_KEYS: ReadonlySet<string> = new Set(["type", "text", MARK])

/** Block types the API refuses to carry a cache mark. */
const UNCACHEABLE_TYPES: ReadonlySet<string> = new Set(["thinking", "redacted_thinking"])

export function hasMark(block: JsonObject): boolean {
  return Object.hasOwn(block, MARK)
}

export function takeMark(block: JsonObject): unknown {
  const mark = block[MARK]
  delete block[MARK]
  return mark
}

export function setMarkIfAbsent(block: JsonObject, mark: unknown): void {
  if (!hasMark(block)) block[MARK] = mark
}

export function isCacheable(block: JsonObject): boolean {
  return typeof block.type !== "string" || !UNCACHEABLE_TYPES.has(block.type)
}

export function isUncacheable(value: unknown): boolean {
  return isObject(value) && !isCacheable(value)
}

export function withoutMark(block: unknown): unknown {
  if (!isObject(block)) return block
  const { [MARK]: _mark, ...rest } = block
  return rest
}

/** Every mark in the value, nested ones included. The API counts all of them toward its limit. */
export function countMarks(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countMarks(item), 0)
  if (!isObject(value)) return 0
  return Object.entries(value).reduce(
    (sum, [key, item]) => sum + (key === MARK ? 1 : countMarks(item)),
    0,
  )
}

/** A text block with no field besides its type, text and mark. */
export function isPlainText(block: unknown): block is JsonObject {
  return (
    isObject(block) &&
    block.type === "text" &&
    Object.keys(block).every((key) => PLAIN_TEXT_KEYS.has(key))
  )
}

/**
 * How many blocks stand before the one place where `frame` occurs in `blocks`, ignoring marks.
 * Zero when the frame is missing, is found more than once, or already starts the list.
 */
export function leadingLength(blocks: readonly unknown[], frame: readonly unknown[]): number {
  const wanted = frame.map(withoutMark)
  const starts: number[] = []
  for (let start = 0; start + wanted.length <= blocks.length; start += 1) {
    const window = blocks.slice(start, start + wanted.length).map(withoutMark)
    if (jsonEqual(window, wanted)) starts.push(start)
  }
  return starts.length === 1 ? (starts[0] ?? 0) : 0
}

/**
 * Removes the first `count` blocks when all of them are plain text. The first mark among them
 * moves to the block that becomes first, unless that block has its own.
 */
export function dropLeadingText(blocks: unknown[], count: number): boolean {
  const leading = blocks.slice(0, count)
  if (!leading.every(isPlainText)) return false
  const mark = leading.find(hasMark)?.[MARK]
  blocks.splice(0, count)
  const head = blocks[0]
  if (mark !== undefined && mark !== null && isObject(head)) setMarkIfAbsent(head, mark)
  return true
}
