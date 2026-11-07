import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

export interface ProcessOptions {
  env?: NodeJS.ProcessEnv
  input?: string
  signal?: AbortSignal
  timeoutMs?: number
  /** Bytes of each stream kept in memory; older bytes are dropped. */
  maxBytes?: number
}

export interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export class ProcessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ProcessError"
  }
}

/** Keep only the tail of a stream so a long-running command cannot exhaust memory. */
function keepTail(text: string, chunk: string, maxBytes: number): string {
  const combined = text + chunk
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined
  const buffer = Buffer.from(combined, "utf8")
  return buffer.subarray(Math.max(0, buffer.length - maxBytes)).toString("utf8")
}

/** Run one local process, capture its output, and honour cancellation and timeout. */
export async function runProcess(
  argv: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const maxBytes = options.maxBytes ?? 1_000_000
  if (options.signal?.aborted === true) throw abortReason(options.signal)
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const outDecoder = new StringDecoder("utf8")
    const errDecoder = new StringDecoder("utf8")
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    let timeout: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout)
      if (killTimer !== undefined) clearTimeout(killTimer)
      options.signal?.removeEventListener("abort", onAbort)
    }

    const finish = (result: ProcessResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const stop = (): void => {
      if (settled || child.exitCode !== null) return
      child.kill("SIGTERM")
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL")
      }, 2000)
      killTimer.unref()
    }

    const onAbort = (): void => {
      stop()
      fail(abortReason(options.signal))
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true
        stop()
      }, options.timeoutMs)
      timeout.unref()
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = keepTail(stdout, outDecoder.write(chunk), maxBytes)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = keepTail(stderr, errDecoder.write(chunk), maxBytes)
    })
    child.on("error", (error) => {
      fail(
        new ProcessError(`Could not run ${JSON.stringify(argv[0])}: ${error.message}`, {
          cause: error,
        }),
      )
    })
    child.on("close", (code) => {
      stdout += outDecoder.end()
      stderr += errDecoder.end()
      if (timedOut) {
        finish({ code, stdout, stderr, timedOut: true })
        return
      }
      if (options.signal?.aborted === true) {
        fail(abortReason(options.signal))
        return
      }
      finish({ code, stdout, stderr, timedOut: false })
    })

    child.stdin.on("error", () => {
      // The remote may close stdin before the input is fully written.
    })
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  return new Error("The tool call was cancelled")
}
