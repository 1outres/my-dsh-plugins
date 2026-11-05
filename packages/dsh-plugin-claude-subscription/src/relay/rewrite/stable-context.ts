import type { JsonObject, NativeBlock } from "../../contract"
import { dropLeadingText, leadingLength, setMarkIfAbsent } from "./blocks"
import { isObject, parseJsonObject, readMessages, serializeBody } from "./payload"

// The only trailing system text that moves: the CLI's date line. Other trailing text can differ on
// every request, and moving it would change the prefix from message 1 on.
const DATE_LINE = /^Today's date is [0-9]{4}-[0-9]{2}-[0-9]{2}\.$/
const ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant"])

interface TextBlock extends NativeBlock {
  type: "text"
  text: string
}

interface Message extends JsonObject {
  role: string
  content: string | NativeBlock[]
}

function isTextBlock(block: NativeBlock): block is TextBlock {
  return block.type === "text" && typeof block.text === "string"
}

function isWellFormedBlock(block: unknown): block is NativeBlock {
  return (
    isObject(block) &&
    typeof block.type === "string" &&
    (block.type !== "text" || typeof block.text === "string")
  )
}

function isMessage(message: JsonObject): message is Message {
  const { role, content } = message
  return (
    typeof role === "string" &&
    ROLES.has(role) &&
    (typeof content === "string" || (Array.isArray(content) && content.every(isWellFormedBlock)))
  )
}

function soleText(content: string | NativeBlock[]): TextBlock | undefined {
  if (typeof content === "string") return { type: "text", text: content }
  const [only] = content
  return content.length === 1 && only !== undefined && isTextBlock(only) ? only : undefined
}

function appendToEnvironment(environment: Message, date: string): boolean {
  const addition = `\n\n${date}`
  const { content } = environment
  if (typeof content === "string") {
    if (content.endsWith(date)) return false
    environment.content = content + addition
    return true
  }
  const last = content[content.length - 1]
  if (last === undefined || !isTextBlock(last) || last.text.endsWith(date)) return false
  last.text += addition
  return true
}

/** Moves the trailing date line into the environment message. A mark on it moves to the block before. */
function returnDateLine(messages: Message[]): boolean {
  const last = messages[messages.length - 1]
  const environment = messages.slice(0, -1).find((message) => message.role === "system")
  if (last === undefined || last.role !== "system" || environment === undefined) return false
  const date = soleText(last.content)
  if (date === undefined || !DATE_LINE.test(date.text)) return false
  if (!appendToEnvironment(environment, date.text)) return false

  const mark = Object.hasOwn(date, "cache_control") ? date.cache_control : last.cache_control
  messages.pop()
  const previous = messages[messages.length - 1]?.content
  if (mark !== undefined && mark !== null && Array.isArray(previous) && previous.length > 0) {
    setMarkIfAbsent(previous[previous.length - 1], mark)
  }
  return true
}

function newestUser(messages: readonly Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index]
  }
  return undefined
}

/** Drops the plain text the CLI put before the queried frame of a later user turn. */
function dropNewestTurnContext(
  messages: readonly Message[],
  queried: readonly NativeBlock[],
): boolean {
  if (!queried.some((block) => block.type !== "tool_result")) return false
  if (!messages.some((message) => message.role === "assistant")) return false
  const newest = newestUser(messages)
  if (newest === undefined || !Array.isArray(newest.content)) return false
  const count = leadingLength(newest.content, queried)
  return count > 0 && dropLeadingText(newest.content, count)
}

/**
 * Keeps the CLI's per-request context in the prefix that later requests replay.
 *
 * The CLI puts today's date into a trailing system message and prepends reminders to the newest
 * user turn. Neither position comes back in the next request, so the cached prefix would break.
 * This returns the date line to the environment message, and drops plain text before the queried
 * frame, which must occur exactly once. Marks on removed blocks move on and never multiply.
 * An already stable or unexpected payload returns unchanged.
 */
export function stableRequestContext(payload: Buffer, queried: readonly NativeBlock[]): Buffer {
  const body = parseJsonObject(payload)
  const messages = body === undefined ? undefined : readMessages(body)
  if (body === undefined || messages === undefined || !messages.every(isMessage)) return payload
  const movedDate = returnDateLine(messages)
  const droppedContext = dropNewestTurnContext(messages, queried)
  return movedDate || droppedContext ? serializeBody(body) : payload
}
