import type { NativeDeps } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { abortedFailure, INSTALL_HINT } from "./failures"

// DSH loads its own copy of the seam's package, so the class cannot be compared by identity.
const NOT_FOUND_ERROR = "SubprocessExecutableNotFoundError"

/** The absolute path of the configured CLI. A missing one raises `claudeCodeMissing`. */
export async function resolveClaude(deps: NativeDeps, signal?: AbortSignal): Promise<string> {
  const { command } = deps.settings()
  try {
    return await deps.subprocess.resolveExecutable(command, undefined, signal)
  } catch (error) {
    if (signal?.aborted === true) throw abortedFailure(error)
    if (error instanceof Error && error.name === NOT_FOUND_ERROR) {
      throw new NativeFailure(INSTALL_HINT, FailureCode.claudeCodeMissing, {
        status: 503,
        cause: error,
      })
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new NativeFailure(
      `The \`command\` plugin setting cannot be used: ${detail}`,
      FailureCode.nativeProtocol,
      { cause: error },
    )
  }
}
