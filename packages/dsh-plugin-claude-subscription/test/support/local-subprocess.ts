import { type ChildProcess, spawn as spawnChild } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type {
  SubprocessCollect,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from "@deepseek-ai/dsh-subprocess"
import {
  SENSITIVE_ENV_PATTERN,
  SubprocessExecutableNotFoundError,
} from "@deepseek-ai/dsh-subprocess"
import type { Env, NativeDeps } from "../../src/contract"

export interface RecordedSpawn {
  spec: SubprocessSpawnSpec
  handle: SubprocessHandle
  pid: number | undefined
}

export interface LocalSubprocess
  extends Pick<NativeDeps["subprocess"], "spawn" | "resolveExecutable"> {
  readonly spawned: readonly RecordedSpawn[]
  terminateAll(): Promise<void>
}

class CollectedTail implements SubprocessOutputReader {
  #kept = Buffer.alloc(0)
  #total = 0
  readonly #maxBytes: number

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes
  }

  push(chunk: Buffer): void {
    this.#total += chunk.length
    const joined = Buffer.concat([this.#kept, chunk])
    this.#kept = joined.subarray(Math.max(0, joined.length - this.#maxBytes))
  }

  readFrom(fromByte: number) {
    const start = this.#total - this.#kept.length
    const lossy = fromByte < start
    const offset = lossy ? 0 : fromByte - start
    return { text: this.#kept.subarray(offset).toString("utf8"), nextOffset: this.#total, lossy }
  }
}

function isCollect(mode: SubprocessOutputMode): mode is SubprocessCollect {
  return typeof mode === "object"
}

function stdioMode(mode: SubprocessOutputMode): "pipe" | "inherit" {
  return mode === "inherit" ? "inherit" : "pipe"
}

function collectInto(mode: SubprocessOutputMode, stream: NodeJS.ReadableStream | null) {
  if (!isCollect(mode) || stream === null) return undefined
  const tail = new CollectedTail(mode.maxBytes)
  stream.on("data", (chunk: Buffer) => tail.push(chunk))
  return tail
}

function childEnvironment(
  ambient: Env,
  explicit: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(ambient)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(name)) env[name] = value
  }
  for (const [name, value] of Object.entries(explicit ?? {})) {
    if (value === undefined) delete env[name]
    else env[name] = value
  }
  return env
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // The whole group is already gone.
  }
}

function outcomeOf(child: ChildProcess, graceMs: number): Promise<SubprocessOutcome> {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }))
    child.once("exit", (exitCode, signal) => {
      // A descendant that holds a pipe must not keep the outcome open for ever.
      setTimeout(() => resolve({ exitCode, signal }), graceMs).unref()
    })
  })
}

function localHandle(child: ChildProcess, spec: SubprocessSpawnSpec): SubprocessHandle {
  const stderr = collectInto(spec.stdio.stderr, child.stderr)
  const stdout = collectInto(spec.stdio.stdout, child.stdout)
  const done = outcomeOf(child, spec.graceMs)
  done.catch(() => {})
  let terminating = false

  const terminate = () => {
    const { pid } = child
    if (terminating || pid === undefined) return
    terminating = true
    signalGroup(pid, "SIGTERM")
    setTimeout(() => signalGroup(pid, "SIGKILL"), spec.graceMs).unref()
  }

  const waitForExit = async (signal?: AbortSignal) => {
    const { pid } = child
    while (pid !== undefined && groupAlive(pid)) {
      if (signal?.aborted === true) return false
      await sleep(5)
    }
    return true
  }

  if (spec.signal !== undefined) spec.signal.addEventListener("abort", terminate, { once: true })

  return {
    stdin: spec.stdio.stdin === "pipe" ? (child.stdin ?? undefined) : undefined,
    stdout: spec.stdio.stdout === "pipe" ? (child.stdout ?? undefined) : undefined,
    stderr: spec.stdio.stderr === "pipe" ? (child.stderr ?? undefined) : undefined,
    control: undefined,
    collected: {
      ...(stdout === undefined ? {} : { stdout }),
      ...(stderr === undefined ? {} : { stderr }),
    },
    done,
    terminate,
    waitForExit,
  }
}

function startChild(spec: SubprocessSpawnSpec, ambient: Env): ChildProcess {
  const [program, ...args] = spec.argv
  if (program === undefined) throw new Error("argv must name a program")
  const { stdin } = spec.stdio
  const child = spawnChild(program, args, {
    cwd: spec.cwd,
    env: childEnvironment(ambient, spec.env),
    detached: true,
    stdio: [
      stdin === "ignore" ? "ignore" : "pipe",
      stdioMode(spec.stdio.stdout),
      stdioMode(spec.stdio.stderr),
    ],
  })
  if (typeof stdin === "object") child.stdin?.end(stdin.data)
  return child
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The subprocess seam on real child processes. It follows the contract of DSH's local provider. */
export function localSubprocess(ambient: Env): LocalSubprocess {
  const spawned: RecordedSpawn[] = []
  return {
    spawned,
    spawn(spec) {
      spec.signal?.throwIfAborted()
      const child = startChild(spec, ambient)
      const handle = localHandle(child, spec)
      spawned.push({ spec, handle, pid: child.pid })
      return handle
    },
    async resolveExecutable(command, env, signal) {
      signal?.throwIfAborted()
      const path = env?.PATH ?? ambient.PATH ?? ""
      const candidates = isAbsolute(command)
        ? [command]
        : path.split(delimiter).map((directory) => join(directory, command))
      const found = candidates.find(isExecutable)
      if (found === undefined) throw new SubprocessExecutableNotFoundError(`${command} not found`)
      return found
    },
    async terminateAll() {
      for (const { handle } of spawned) handle.terminate()
      await Promise.all(
        spawned.map(async ({ handle }) => {
          await handle.done.catch(() => {})
          await handle.waitForExit()
          handle.stdin?.destroy()
          handle.stdout?.destroy()
        }),
      )
    },
  }
}
