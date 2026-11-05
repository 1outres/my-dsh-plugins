import type { JsonObject } from "../../src/contract"

export type Json = JsonObject

export function wire(messages: unknown[], extra: JsonObject = {}): Buffer {
  return Buffer.from(JSON.stringify({ model: "m", ...extra, messages }))
}

export function bodyOf(payload: Buffer): JsonObject {
  return JSON.parse(payload.toString("utf8")) as JsonObject
}

export function messagesOf(payload: Buffer): JsonObject[] {
  return bodyOf(payload).messages as JsonObject[]
}

export function contentOf(message: JsonObject | undefined): JsonObject[] {
  return (message?.content ?? []) as JsonObject[]
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

/** The value without any `cache_control`, at any depth. */
export function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "cache_control")
        .map(([key, item]) => [key, plain(item)]),
    )
  }
  return value
}

/** Positions `[message, block]` of the top-level `cache_control` marks in the messages. */
export function messageMarks(body: JsonObject): [number, number][] {
  const marks: [number, number][] = []
  ;(body.messages as JsonObject[]).forEach((message, i) => {
    if (!Array.isArray(message.content)) return
    ;(message.content as JsonObject[]).forEach((block, j) => {
      if ("cache_control" in block) marks.push([i, j])
    })
  })
  return marks
}

/** Every `cache_control` the API counts toward its limit of four, nested ones included. */
export function countMarks(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countMarks(item), 0)
  if (typeof value !== "object" || value === null) return 0
  const entries = Object.entries(value)
  const own = entries.some(([key]) => key === "cache_control") ? 1 : 0
  return (
    own +
    entries
      .filter(([key]) => key !== "cache_control")
      .reduce((sum, [, item]) => sum + countMarks(item), 0)
  )
}

/** JSON text with sorted keys, so equal values give equal text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}
