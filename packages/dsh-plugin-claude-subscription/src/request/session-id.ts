import { createHash } from "node:crypto"
import type { NativeFrame } from "../contract"

const VERSION_4 = 0x40
const VARIANT_RFC_4122 = 0x80

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}

/**
 * A native session id that stays the same for every request of one conversation.
 *
 * It comes from what a conversation starts with, the system prompt and the first frame.
 * Every request replays both unchanged until compaction rewrites the history.
 * With feature flags on, the CLI writes the session id into the environment message after
 * the first user turn, so a new id on each call would break the prompt cache.
 */
export function conversationSessionId(system: string, frames: readonly NativeFrame[]): string {
  const first = frames[0]?.message ?? null
  const digest = createHash("sha256")
    .update(canonicalJson([system, first]), "utf8")
    .digest()
  const bytes = digest.subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | VERSION_4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | VARIANT_RFC_4122
  return formatUuid(bytes)
}
