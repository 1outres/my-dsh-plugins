import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SubprocessHandle, SubprocessStdinMode } from "@deepseek-ai/dsh-subprocess"
import type { NativeDeps } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { abortedFailure, throwIfAborted, timeoutFailure } from "./failures"

const GRACE_MS = 2_000
// The handshake answer also lists the CLI's commands, so it can be large. Only the tail is kept.
const OUTPUT_BYTES = 8 * 1024 * 1024
const STDERR_BYTES = 16 * 1024

export interface ProbeSpec {
  argv: readonly string[]
  stdin: SubprocessStdinMode
  env: NodeJS.ProcessEnv
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface ProbeOutput {
  stdout: string
  stderr: string
  exitCode: number | null
}

function startFailure(error: unknown): NativeFailure {
  const detail = error instanceof Error ? error.message : String(error)
  return new NativeFailure(`Claude Code could not start: ${detail}`, FailureCode.nativeProtocol, {
    cause: error,
  })
}

function collectedText(handle: SubprocessHandle, stream: "stdout" | "stderr"): string {
  return handle.collected[stream]?.readFrom(0).text ?? ""
}

/** Runs one short CLI command to its end and returns what it printed. */
export async function runProbe(deps: NativeDeps, spec: ProbeSpec): Promise<ProbeOutput> {
  throwIfAborted(spec.signal)
  const deadline = AbortSignal.timeout(spec.timeoutMs)
  const classify = (error: unknown): NativeFailure => {
    if (spec.signal?.aborted === true) return abortedFailure(error)
    if (deadline.aborted) return timeoutFailure()
    return startFailure(error)
  }
  let handle: SubprocessHandle
  try {
    handle = deps.subprocess.spawn({
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      graceMs: GRACE_MS,
      signal: AbortSignal.any(spec.signal === undefined ? [deadline] : [deadline, spec.signal]),
      stdio: {
        stdin: spec.stdin,
        stdout: { maxBytes: OUTPUT_BYTES },
        stderr: { maxBytes: STDERR_BYTES },
      },
    })
  } catch (error) {
    throw classify(error)
  }
  try {
    const { exitCode } = await handle.done
    throwIfAborted(spec.signal)
    if (deadline.aborted) throw timeoutFailure()
    return {
      stdout: collectedText(handle, "stdout"),
      stderr: collectedText(handle, "stderr"),
      exitCode,
    }
  } catch (error) {
    if (error instanceof NativeFailure) throw error
    throw classify(error)
  } finally {
    handle.terminate()
  }
}

/** Runs `work` in a fresh temp directory and removes it afterwards. */
export async function withProbeDirectory<T>(work: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "claude-subscription-probe-"))
  try {
    return await work(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
