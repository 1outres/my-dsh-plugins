import type { SubprocessHandle } from "@deepseek-ai/dsh-subprocess"
import type {
  Env,
  JsonObject,
  NativeBlock,
  NativeCompletion,
  NativeDeps,
  NativeFrame,
  NativeStreamEvent,
  PluginSettings,
  PreparedRequest,
  Relay,
  RunNative,
} from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { turnArgv } from "./argv"
import { NativeChannel } from "./channel"
import { drainAfterAnswer, settledWithin } from "./drain"
import { assertNoBackendOverride, nativeEnv } from "./env"
import { resolveClaude } from "./executable"
import { abortedFailure, throwIfAborted, withoutRelayRoute } from "./failures"
import { type RequestFiles, removeRequestFiles, writeRequestFiles } from "./request-files"
import { fastEligible, finishTurn, newTurnState, recordEvent, type TurnEnding } from "./turn"
import { sharedWorkdir } from "./workdir"

const ANTHROPIC_API = "https://api.anthropic.com"
const GRACE_MS = 2_000
const STDERR_BYTES = 16_384
const STOP_WAIT_MS = GRACE_MS + 3_000

function queriedBlocks(request: PreparedRequest): readonly NativeBlock[] {
  const last = request.frames.at(-1)
  if (last === undefined) {
    throw new NativeFailure("The request holds no frame to query", FailureCode.invalidRequest)
  }
  return last.message.content
}

interface TurnContext {
  request: PreparedRequest
  signal: AbortSignal | undefined
  deps: NativeDeps
  settings: PluginSettings
  processEnv: Env
  idleMs: number
  cwd: string
  executable: string
  files: RequestFiles
  queried: readonly NativeBlock[]
}

async function openRelay(request: PreparedRequest, context: TurnContext): Promise<Relay> {
  try {
    return await context.deps.createRelay({
      upstream: ANTHROPIC_API,
      timeoutMs: context.idleMs,
      queried: context.queried,
      oneShot: request.oneShot,
      env: context.processEnv,
    })
  } catch (error) {
    if (error instanceof NativeFailure) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new NativeFailure(`The relay could not open: ${detail}`, FailureCode.relayError, {
      cause: error,
    })
  }
}

// The caller's signal must stop reaching the process after a fast return, so the process gets
// its own signal, linked until then.
class ProcessAbort {
  readonly #controller = new AbortController()
  readonly #source: AbortSignal | undefined
  readonly #forward = () => this.#controller.abort()

  constructor(source: AbortSignal | undefined) {
    this.#source = source
    if (source?.aborted === true) this.#controller.abort()
    source?.addEventListener("abort", this.#forward, { once: true })
  }

  get signal(): AbortSignal {
    return this.#controller.signal
  }

  release(): void {
    this.#source?.removeEventListener("abort", this.#forward)
  }
}

function spawnClaude(
  context: TurnContext,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): SubprocessHandle {
  const { request, deps, executable, files, cwd } = context
  try {
    return deps.subprocess.spawn({
      argv: turnArgv(executable, request, files, deps),
      cwd,
      env,
      graceMs: GRACE_MS,
      signal,
      stdio: { stdin: "pipe", stdout: "pipe", stderr: { maxBytes: STDERR_BYTES } },
    })
  } catch (error) {
    if (signal.aborted) throw abortedFailure(error)
    const detail = error instanceof Error ? error.message : String(error)
    throw new NativeFailure(`Claude Code could not start: ${detail}`, FailureCode.nativeProtocol, {
      cause: error,
    })
  }
}

function frameLine(frame: NativeFrame, replayed: boolean): string {
  return `${JSON.stringify(replayed ? { ...frame, shouldQuery: false } : frame)}\n`
}

async function awaitReplayAcknowledgment(
  channel: NativeChannel,
  stderrTail: () => string,
): Promise<void> {
  while (true) {
    const event = await channel.receive()
    if (event === null) {
      throw new NativeFailure(
        `Native exited before replay acknowledgment (exit=${channel.exitCode})${stderrTail()}`,
        FailureCode.nativeProtocol,
      )
    }
    if (event.type !== "result") continue
    if (event.num_turns !== 0 || event.is_error) {
      throw new NativeFailure(
        `Native history replay not supported: expected zero-turn acknowledgment${stderrTail()}`,
        FailureCode.nativeProtocol,
      )
    }
    return
  }
}

async function sendFrames(
  channel: NativeChannel,
  frames: readonly NativeFrame[],
  stderrTail: () => string,
): Promise<void> {
  for (const [index, frame] of frames.entries()) {
    const replayed = frame.type === "user" && index < frames.length - 1
    await channel.write(frameLine(frame, replayed))
    if (replayed) await awaitReplayAcknowledgment(channel, stderrTail)
  }
  await channel.endInput()
}

function startDrain(handle: SubprocessHandle, relay: Relay, channel: NativeChannel): void {
  channel.discardOutput()
  // Nobody is left to receive a drain failure, and the answer has already gone to the caller.
  void drainAfterAnswer(handle, relay)
    .catch(() => {})
    .finally(() => channel.close())
}

async function stopProcess(
  handle: SubprocessHandle,
  relay: Relay,
  channel: NativeChannel,
): Promise<void> {
  handle.terminate()
  relay.abort()
  await settledWithin(handle.done, STOP_WAIT_MS)
  channel.close()
  // A failing close must not replace the call's own outcome.
  await relay.close().catch(() => {})
}

function childEnv(context: TurnContext, relay: Relay): NodeJS.ProcessEnv {
  const { settings, processEnv, request } = context
  return {
    ...nativeEnv(settings, processEnv),
    ANTHROPIC_BASE_URL: relay.url,
    ...(request.maxOutputTokens === undefined
      ? {}
      : { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(request.maxOutputTokens) }),
  }
}

async function* runProcess(
  context: TurnContext,
  relay: Relay,
): AsyncGenerator<NativeStreamEvent, NativeCompletion, void> {
  const { request, signal } = context
  const processAbort = new ProcessAbort(signal)
  const abortRelay = () => relay.abort()
  processAbort.signal.addEventListener("abort", abortRelay, { once: true })
  const stopWatching = () => {
    processAbort.release()
    processAbort.signal.removeEventListener("abort", abortRelay)
  }
  let handle: SubprocessHandle
  try {
    handle = spawnClaude(context, childEnv(context, relay), processAbort.signal)
  } catch (error) {
    stopWatching()
    await relay.close().catch(() => {})
    throw error
  }

  const channel = new NativeChannel(handle, {
    idleMs: context.idleMs,
    signal,
    redact: (text) => withoutRelayRoute(text, relay.url),
  })
  const stderrTail = () => channel.stderrTail()
  let handedOff = false
  try {
    await sendFrames(channel, request.frames, stderrTail)
    const state = newTurnState()
    let ending: TurnEnding | null = null
    while (ending === null) {
      const event: JsonObject | null = await channel.receive()
      if (event === null) {
        ending = { fast: false, exitCode: channel.exitCode }
        break
      }
      const streamEvent = recordEvent(state, event, stderrTail)
      if (streamEvent !== null) yield streamEvent
      if (event.type === "result" && fastEligible(event, relay, state)) ending = { fast: true }
    }
    if (ending.fast) {
      stopWatching()
      handedOff = true
      startDrain(handle, relay, channel)
    } else {
      throwIfAborted(signal)
    }
    return finishTurn(state, relay, ending, stderrTail())
  } finally {
    stopWatching()
    if (!handedOff) await stopProcess(handle, relay, channel)
  }
}

/**
 * Runs one model call: `claude -p` in stream-json mode behind a per-request relay. Yields raw
 * stream events as they arrive and returns the relay's capture. A failure raises `NativeFailure`.
 */
export const runNative: RunNative = async function* (request, signal, deps) {
  throwIfAborted(signal)
  const processEnv = deps.processEnv()
  assertNoBackendOverride(processEnv)
  const settings = deps.settings()
  const queried = queriedBlocks(request)
  const cwd = sharedWorkdir()
  const executable = await resolveClaude(deps, signal)
  const files = await writeRequestFiles(request)
  const idleMs = settings.readIdleTimeoutSeconds * 1000
  const context: TurnContext = {
    request,
    signal,
    deps,
    settings,
    processEnv,
    idleMs,
    cwd,
    executable,
    files,
    queried,
  }
  try {
    const relay = await openRelay(request, context)
    if (signal?.aborted === true) {
      await relay.close().catch(() => {})
      throw abortedFailure()
    }
    return yield* runProcess(context, relay)
  } finally {
    await removeRequestFiles(files).catch(() => {})
  }
}
