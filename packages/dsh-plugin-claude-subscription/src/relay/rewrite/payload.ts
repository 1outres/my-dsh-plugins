import type { JsonObject } from "../../contract"

const utf8 = new TextDecoder("utf-8", { fatal: true })

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Undefined when the bytes are not UTF-8 JSON holding one object. */
export function parseJsonObject(payload: Uint8Array): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(utf8.decode(payload))
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

// The CLI writes its requests with JSON.stringify, so parsing and writing a body
// again keeps key order and number text.
export function serializeBody(body: JsonObject): Buffer {
  return Buffer.from(JSON.stringify(body), "utf8")
}

/** The `messages` array when every entry is an object. */
export function readMessages(body: JsonObject): JsonObject[] | undefined {
  const { messages } = body
  return Array.isArray(messages) && messages.every(isObject) ? messages : undefined
}

/** Structural JSON equality. Key order does not matter and types are never coerced. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    )
  }
  if (!isObject(left) || !isObject(right)) return false
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
  )
}

/** Index of the last assistant message, or -1 when there is none. */
export function lastAssistantIndex(messages: readonly JsonObject[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return index
  }
  return -1
}
