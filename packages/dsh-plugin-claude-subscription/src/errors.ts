/** Stable failure codes. DSH retries and compaction route on these strings. */
export const FailureCode = {
  aborted: "ABORTED",
  contextWindowExceeded: "CONTEXT_WINDOW_EXCEEDED",
  emptyResponse: "EMPTY_RESPONSE",
  imageOffloadRequired: "IMAGE_OFFLOAD_REQUIRED",
  invalidCredential: "INVALID_CREDENTIAL",
  quota: "QUOTA",
  rateLimit: "RATE_LIMIT",
  timeout: "TIMEOUT",
  server: "SERVER",
  transport: "TRANSPORT",
  claudeCodeMissing: "CLAUDE_CODE_MISSING",
  conflictingEnvironment: "CONFLICTING_ENVIRONMENT",
  invalidRequest: "INVALID_REQUEST",
  nativeProtocol: "NATIVE_PROTOCOL",
  upstreamError: "UPSTREAM_ERROR",
  relayError: "RELAY_ERROR",
} as const

export type FailureCodeValue = (typeof FailureCode)[keyof typeof FailureCode]

export interface NativeFailureFacts {
  status?: number
  providerRetryAfterMs?: number
  requestId?: string
  /** With `imageOffloadRequired`: how many more of the oldest images DSH must offload. */
  offloadImages?: number
  cause?: unknown
}

const REQUEST_ID = /^req_[A-Za-z0-9_-]{1,124}$/

/**
 * A failed model call. `code` and `failure` are own data properties because
 * DSH reads them from foreign errors without relying on class identity.
 */
export class NativeFailure extends Error {
  readonly code: FailureCodeValue
  readonly failure: {
    readonly message: string
    readonly code: FailureCodeValue
    readonly status?: number
    readonly providerRetryAfterMs?: number
    readonly requestId?: string
    readonly offloadImages?: number
  }

  constructor(message: string, code: FailureCodeValue, facts: NativeFailureFacts = {}) {
    // Only a bounded opaque id may enter diagnostics, never arbitrary header contents.
    const requestId =
      facts.requestId !== undefined && REQUEST_ID.test(facts.requestId)
        ? facts.requestId
        : undefined
    const text = requestId === undefined ? message : `${message} (request_id=${requestId})`
    super(text, facts.cause === undefined ? undefined : { cause: facts.cause })
    this.name = "NativeFailure"
    this.code = code
    this.failure = {
      message: text,
      code,
      ...(facts.status === undefined ? {} : { status: facts.status }),
      ...(facts.providerRetryAfterMs === undefined
        ? {}
        : { providerRetryAfterMs: facts.providerRetryAfterMs }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(facts.offloadImages === undefined ? {} : { offloadImages: facts.offloadImages }),
    }
  }
}
