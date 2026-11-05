import type { Relay } from "../contract"
import { FailureCode, type FailureCodeValue, NativeFailure } from "../errors"

export const INSTALL_HINT =
  "Claude Code is not installed. Install it with `npm install -g @anthropic-ai/claude-code`, or set the `command` plugin setting to the binary."
export const LOGIN_HINT =
  "Claude Code is installed but not logged in. Run `claude auth login`, then select this provider again."
export const LOGGED_OUT_HINT =
  "Claude Code is installed but has no usable login where DSH runs it. Run `claude auth login` as the user DSH runs as, or point the `claudeConfigDir` plugin setting at a logged-in config directory, then try again."

const STDERR_LINES = 40
const STDERR_CHARS = 400
const UPSTREAM_TEXT_CHARS = 500

interface FailureShape {
  code: FailureCodeValue
  status?: number
}

const NATIVE_ANSWERS: Readonly<Record<string, FailureShape>> = {
  rate_limit: { code: FailureCode.rateLimit, status: 429 },
  billing_error: { code: FailureCode.quota, status: 402 },
  authentication_failed: { code: FailureCode.invalidCredential, status: 401 },
  overloaded: { code: FailureCode.server, status: 529 },
  // The CLI uses this code for capacity, 5xx and login-refresh races. All of them are transient.
  server_error: { code: FailureCode.server, status: 503 },
}

// The API sends these inside a 200 stream, where the status line cannot carry them.
const STREAM_ERRORS: ReadonlyMap<string, FailureShape> = new Map([
  ["overloaded_error", { code: FailureCode.server, status: 529 }],
  ["rate_limit_error", { code: FailureCode.rateLimit, status: 429 }],
  ["api_error", { code: FailureCode.server, status: 500 }],
  ["authentication_error", { code: FailureCode.invalidCredential, status: 401 }],
])

const CONTEXT_WINDOW_MESSAGES: readonly RegExp[] = [
  /prompt is too long/i,
  /\bexceed(?:s|ed)?\s+(?:the\s+)?(?:model(?:'s)?\s+)?context\s+(?:limit|length|window)\b/i,
  /\bcontext[\s_-](?:length|window)[\s_-](?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)\b/i,
  /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i,
  /\btoo\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?(?:model(?:'s)?\s+)?context\b/i,
]

function isContextWindowMessage(text: string): boolean {
  return CONTEXT_WINDOW_MESSAGES.some((pattern) => pattern.test(text))
}

/** Removes the relay's private route from text that came from the CLI. */
export function withoutRelayRoute(text: string, relayUrl: string): string {
  return text.replaceAll(relayUrl, "<relay>")
}

export function abortedFailure(cause?: unknown): NativeFailure {
  return new NativeFailure(
    "Claude request cancelled",
    FailureCode.aborted,
    cause === undefined ? {} : { cause },
  )
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortedFailure()
}

export function timeoutFailure(): NativeFailure {
  return new NativeFailure("Claude request timed out", FailureCode.timeout)
}

/** Text to append to a failure message, from the last lines of the CLI's stderr. */
export function stderrSuffix(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  const text = lines.slice(-STDERR_LINES).join(" ").slice(0, STDERR_CHARS)
  return text === "" ? "" : ` (native stderr: ${text})`
}

/** An error the CLI answered itself, such as a plan limit. */
export function nativeAnswerFailure(
  code: string | undefined,
  text: string,
  stderrTail: string,
): NativeFailure {
  const message = `Native API error: ${text}${stderrTail}`
  if (isContextWindowMessage(text)) {
    return new NativeFailure(message, FailureCode.contextWindowExceeded)
  }
  const shape = code === undefined ? undefined : NATIVE_ANSWERS[code]
  if (shape === undefined) return new NativeFailure(message, FailureCode.nativeProtocol)
  const facts = shape.status === undefined ? {} : { status: shape.status }
  return new NativeFailure(message, shape.code, facts)
}

/** No usable login where DSH runs the CLI. It refused before any upstream request. */
export function loggedOutFailure(detail: string, stderrTail: string): NativeFailure {
  const suffix = detail === "" ? "" : ` (native: ${detail})`
  return new NativeFailure(
    `${LOGGED_OUT_HINT}${suffix}${stderrTail}`,
    FailureCode.invalidCredential,
    {
      status: 401,
    },
  )
}

function codeForStatus(status: number, upstreamText: string): FailureCodeValue {
  if (isContextWindowMessage(upstreamText)) return FailureCode.contextWindowExceeded
  if (status === 429) return FailureCode.rateLimit
  if (status === 401 || status === 403) return FailureCode.invalidCredential
  if (status === 402) return FailureCode.quota
  if (status >= 500) return FailureCode.server
  return FailureCode.upstreamError
}

function firstAttemptSummary(relay: Relay, upstreamText: string): string {
  const capture = relay.capture.complete ? "complete" : "incomplete"
  const parts = [`status ${relay.status ?? "none"}`, `capture ${capture}`]
  if (relay.failure !== null) parts.push(`relay failure ${relay.failure}`)
  parts.push(`native retries denied: ${relay.denied}`)
  if (upstreamText !== "") parts.push(`upstream said: ${upstreamText}`)
  return `first upstream attempt: ${parts.join(", ")}`
}

function streamErrorShape(type: string, text: string): FailureShape {
  if (type === "invalid_request_error") {
    const code = isContextWindowMessage(text)
      ? FailureCode.contextWindowExceeded
      : FailureCode.upstreamError
    return { code, status: 400 }
  }
  return STREAM_ERRORS.get(type) ?? { code: FailureCode.transport }
}

/**
 * The admitted request did not end in a complete answer. The CLI's own last error is usually the
 * relay's denial of its retry, so this names what the first attempt really met.
 */
export function upstreamFailure(relay: Relay, nativeError: string | null): NativeFailure {
  const requestId = relay.requestId === null ? {} : { requestId: relay.requestId }
  const retryAfter = relay.retryAfterMs === null ? {} : { providerRetryAfterMs: relay.retryAfterMs }
  const streamError = relay.capture.error
  if (streamError !== null) {
    const text = streamError.message.slice(0, UPSTREAM_TEXT_CHARS)
    const { code, status } = streamErrorShape(streamError.type, text)
    return new NativeFailure(text, code, {
      ...(status === undefined ? {} : { status }),
      ...requestId,
      ...retryAfter,
    })
  }
  const upstreamText = relay.errorText().slice(0, UPSTREAM_TEXT_CHARS)
  const suffix = nativeError === null || nativeError === "" ? "" : `: ${nativeError}`
  const message = `Incomplete upstream response (${firstAttemptSummary(relay, upstreamText)})${suffix}`
  if (relay.status === null || relay.status === 200) {
    return new NativeFailure(message, FailureCode.transport, { ...requestId, ...retryAfter })
  }
  return new NativeFailure(message, codeForStatus(relay.status, upstreamText), {
    status: relay.status,
    ...requestId,
    ...retryAfter,
  })
}
