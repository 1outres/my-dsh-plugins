import { createHash } from "node:crypto"
import type { ToolSchema } from "@deepseek-ai/dsh-llm"
import { type JsonObject, TOOL_PREFIX, type ToolManifestEntry } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { normalizeInputSchema } from "./schema"

const VALID_NAME = /^[A-Za-z0-9_-]{1,64}$/
const MAX_NATIVE_NAME_LENGTH = 50
const ALIAS_STEM_LENGTH = 41
const ALIAS_DIGEST_LENGTH = 8

export interface ToolDeclarations {
  /** The tools as the inert MCP server lists them. */
  manifest: ToolManifestEntry[]
  /** The same tools as the Messages request declares them. */
  wire: JsonObject[]
  /** DSH tool name to the name inside the `mcp__dsh__` prefix. */
  names: Map<string, string>
}

function nativeNameOf(name: string): string {
  if (name.length <= MAX_NATIVE_NAME_LENGTH) return name
  const digest = createHash("sha256").update(name).digest("hex").slice(0, ALIAS_DIGEST_LENGTH)
  return `${name.slice(0, ALIAS_STEM_LENGTH)}_${digest}`
}

/**
 * Declares tools to the CLI. A name longer than 50 characters gets a short stable alias,
 * because the CLI limits the full prefixed name to 64 characters.
 */
export function declareTools(tools: readonly ToolSchema[]): ToolDeclarations {
  const names = new Map<string, string>()
  const owners = new Map<string, string>()
  const manifest: ToolManifestEntry[] = []
  const wire: JsonObject[] = []
  for (const tool of tools) {
    if (!VALID_NAME.test(tool.name) || names.has(tool.name)) {
      throw new NativeFailure(
        "Tool names must be unique ASCII identifiers of at most 64 characters",
        FailureCode.invalidRequest,
      )
    }
    const nativeName = nativeNameOf(tool.name)
    const owner = owners.get(nativeName)
    if (owner !== undefined) {
      throw new NativeFailure(
        `Tool name collision: ${JSON.stringify(tool.name)} and ${JSON.stringify(owner)} map to ${JSON.stringify(nativeName)}`,
        FailureCode.invalidRequest,
      )
    }
    names.set(tool.name, nativeName)
    owners.set(nativeName, tool.name)
    const inputSchema = normalizeInputSchema(tool.parameters)
    manifest.push({ name: nativeName, description: tool.description, inputSchema })
    wire.push({
      name: `${TOOL_PREFIX}${nativeName}`,
      description: tool.description,
      input_schema: inputSchema,
    })
  }
  return { manifest, wire, names }
}
