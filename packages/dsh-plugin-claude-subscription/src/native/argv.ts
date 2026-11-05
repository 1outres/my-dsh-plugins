import { MCP_SERVER_NAME, type NativeDeps, type PreparedRequest } from "../contract"
import type { RequestFiles } from "./request-files"

function inertMcpConfig(deps: NativeDeps, files: RequestFiles): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: { command: deps.nodePath, args: [deps.inertMcpPath, files.tools] },
    },
  })
}

/** The full command line of one model call. */
export function turnArgv(
  executable: string,
  request: PreparedRequest,
  files: RequestFiles,
  deps: NativeDeps,
): string[] {
  return [
    executable,
    "-p",
    "--model",
    request.nativeModel,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--system-prompt-file",
    files.system,
    "--settings",
    files.settings,
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--max-turns",
    "1",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--mcp-config",
    inertMcpConfig(deps, files),
    // The CLI adds a per-turn effort message at its own level unless told, and that message
    // overrides `output_config.effort` from the extra body.
    ...(request.effort === undefined ? [] : ["--effort", request.effort]),
    // One CLI session per conversation: the session id names a scratchpad directory near the top
    // of every request, so a new id per spawn would move the cache prefix.
    "--session-id",
    request.sessionId,
  ]
}
