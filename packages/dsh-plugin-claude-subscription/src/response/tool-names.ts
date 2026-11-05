import { type CapturedMessage, TOOL_PREFIX } from "../contract"

/** Name inside the prefix to DSH name. `toolNames` holds the same pairs the other way round. */
export type NativeToolNames = ReadonlyMap<string, string>

export function invertToolNames(toolNames: ReadonlyMap<string, string>): NativeToolNames {
  return new Map([...toolNames].map(([dshName, nativeName]) => [nativeName, dshName]))
}

/**
 * The CLI sometimes drops the prefix on a tool it was offered (upstream #62), and a name outside
 * the inventory goes to DSH as it is, because DSH owns tool validation (upstream #39).
 */
export function dshToolName(nativeName: string, names: NativeToolNames): string {
  const bare = nativeName.startsWith(TOOL_PREFIX)
    ? nativeName.slice(TOOL_PREFIX.length)
    : nativeName
  return names.get(bare) ?? bare
}

/** Replays the name the CLI was offered, so the model does not learn a dropped prefix. */
export function withOfferedToolNames(
  message: CapturedMessage,
  names: NativeToolNames,
): CapturedMessage {
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "tool_use" && typeof block.name === "string" && names.has(block.name)
        ? { ...block, name: `${TOOL_PREFIX}${block.name}` }
        : block,
    ),
  }
}
