import { WebError } from "@deepseek-ai/dsh-web"

/** Message of an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build a provider failure with a clear message. */
export function providerError(message: string, cause?: unknown): WebError {
  return new WebError(message, "WEB_PROVIDER_ERROR", cause === undefined ? undefined : { cause })
}

/** A response body that does not have the shape Exa promises. */
export function invalidResponseError(
  detail = "Exa returned an unexpected response body",
): WebError {
  return providerError(detail)
}

/** The message shown when no Exa key is stored for the configured reference. */
export function credentialMissingError(ref: string): WebError {
  return new WebError(
    `The Exa API key is not set. Set it in Settings > Exa (credential ${ref}), or export ${ref} in the environment DSH starts from.`,
    "WEB_PROVIDER_CREDENTIAL_MISSING",
  )
}

/** A credential store failure, kept distinct from a missing key. */
export function credentialResolutionError(error: unknown): WebError {
  return providerError(`Exa credential resolution failed: ${errorMessage(error)}`, error)
}

/** The stable cancellation error of this provider. */
export function abortedError(signal?: AbortSignal, cause?: unknown): WebError {
  return new WebError("Exa request aborted", "WEB_ABORTED", {
    cause: signal?.aborted === true ? signal.reason : cause,
  })
}

/** Throw the cancellation error when the caller already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortedError(signal)
}

/** Whether a thrown value is an abort from fetch or an AbortSignal. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

/**
 * Race one asynchronous step against caller cancellation. The attached
 * handlers keep observing an uncooperative operation so a later rejection does
 * not become unhandled.
 */
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(abortedError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError(signal))
    signal.addEventListener("abort", onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
