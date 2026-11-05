import { createHash } from "node:crypto"
import type { JsonObject, NativeBlock } from "../../src/contract"

export interface WireMessage extends JsonObject {
  role: string
  content: string | NativeBlock[]
}

export interface Position {
  message: number
  block: number
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function messagesOf(body: JsonObject): WireMessage[] {
  return Array.isArray(body.messages) ? (body.messages as WireMessage[]) : []
}

export function blocksOf(message: WireMessage): NativeBlock[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content
}

export function arrayField(body: JsonObject, field: string): JsonObject[] {
  const value = body[field]
  return Array.isArray(value) ? (value as JsonObject[]) : []
}

export function wireBlocks(body: JsonObject, role: string): NativeBlock[] {
  return messagesOf(body)
    .filter((message) => message.role === role)
    .flatMap(blocksOf)
}

/** Every `cache_control` value in a request, nested ones included. */
export function allMarks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(allMarks)
  if (!isObject(value)) return []
  const nested = Object.entries(value).flatMap(([key, item]) =>
    key === "cache_control" ? [] : allMarks(item),
  )
  return Object.hasOwn(value, "cache_control") ? [value.cache_control, ...nested] : nested
}

export function messageMarks(body: JsonObject): Position[] {
  return messagesOf(body).flatMap((message, messageIndex) =>
    Array.isArray(message.content)
      ? message.content.flatMap((block, blockIndex) =>
          Object.hasOwn(block, "cache_control")
            ? [{ message: messageIndex, block: blockIndex }]
            : [],
        )
      : [],
  )
}

/** Directives move between requests, and they are not cached prompt text. */
export function withoutMarks<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutMarks) as T
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "cache_control")
      .map(([key, item]) => [key, withoutMarks(item)]),
  ) as T
}

export interface Prompt {
  tools: unknown
  system: unknown
  messages: WireMessage[]
}

export function promptOf(body: JsonObject): Prompt {
  return withoutMarks({
    tools: body.tools,
    system: body.system,
    messages: messagesOf(body),
  })
}

/** The prompt through one block: what a breakpoint on that block covers. */
export function cutAt(prompt: Prompt, at: Position): Prompt {
  const messages = prompt.messages.slice(0, at.message + 1)
  const last = messages[at.message]
  if (last !== undefined && Array.isArray(last.content)) {
    messages[at.message] = { ...last, content: last.content.slice(0, at.block + 1) }
  }
  return { ...prompt, messages }
}

/** Keeps key order, unlike a deep comparison: key order is part of the bytes the API receives. */
export function serialized(value: unknown): string {
  return JSON.stringify(value)
}

export function digest(value: unknown): string {
  return createHash("sha256").update(serialized(value)).digest("hex")
}

/** The path and the two values at the first place two JSON values differ. */
export function firstDifference(left: unknown, right: unknown, path = "$"): string | undefined {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const found = firstDifference(left[index], right[index], `${path}[${index}]`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (serialized(leftKeys) !== serialized(rightKeys)) {
      return `${path} keys ${serialized(leftKeys)} != ${serialized(rightKeys)}`
    }
    for (const key of leftKeys) {
      const found = firstDifference(left[key], right[key], `${path}.${key}`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (left === right) return undefined
  const clip = (value: unknown) => serialized(value)?.slice(0, 300)
  return `${path}: ${clip(left)} != ${clip(right)}`
}
