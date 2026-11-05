import type { JsonObject } from "../../contract"
import { isObject, parseJsonObject, serializeBody } from "./payload"

const FLAG = "eager_input_streaming"

function isUnflaggedTool(tool: unknown): tool is JsonObject {
  return isObject(tool) && !Object.hasOwn(tool, FLAG)
}

/**
 * Asks the API to stream every tool's arguments while the model writes them. The CLI sets the
 * flag only for a first-party base URL, and without it the API holds a long argument until it
 * is complete. A value the CLI already set stays.
 */
export function streamToolInput(payload: Buffer): Buffer {
  const body = parseJsonObject(payload)
  if (body === undefined || !Array.isArray(body.tools)) return payload
  const unflagged = body.tools.filter(isUnflaggedTool)
  if (unflagged.length === 0) return payload
  for (const tool of unflagged) tool[FLAG] = true
  return serializeBody(body)
}
