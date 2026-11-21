import type { FetchLike } from "../contract"
import { abortedError, isAbortError, providerError, throwIfAborted } from "./errors"
import { isRecord, nonEmptyString } from "./json"
import { endpointURL } from "./options"

export interface ExaClientOptions {
  readonly baseURL: string
  readonly fetch: FetchLike
}

/** Recovery advice added to the failures that have a clear next step. */
function hintFor(status: number): string | undefined {
  if (status === 401 || status === 403) {
    return "The Exa API key is wrong or not allowed. Set a new key in Settings > Exa."
  }
  if (status === 402) return "The Exa account has no credits."
  if (status === 429) return "Exa rate limited the request. Retry later."
  return undefined
}

/** Build the provider error of one non-2xx answer, without its request body. */
async function httpError(response: Response, signal?: AbortSignal): Promise<Error> {
  let detail: string | undefined
  let tag: string | undefined
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload)) {
      detail = nonEmptyString(payload.error)
      tag = nonEmptyString(payload.tag)
    }
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error)
  }

  let message = `Exa API error (HTTP ${response.status})`
  if (detail !== undefined) message += `: ${detail}`
  if (tag !== undefined) message += ` [${tag}]`
  const hint = hintFor(response.status)
  if (hint !== undefined) message += `\n\n${hint}`
  return providerError(message)
}

/**
 * The HTTP client shared by both Exa providers. It owns the request contract
 * (JSON, `x-api-key`, no redirects) and the error vocabulary, so providers only
 * build bodies and map answers.
 */
export class ExaClient {
  constructor(private readonly options: ExaClientOptions) {}

  /**
   * Send one JSON request to an Exa endpoint.
   * @param path - endpoint path such as `/search`.
   * @param body - JSON body.
   * @param apiKey - resolved Exa API key; never included in an error message.
   * @param signal - caller cancellation.
   * @returns the parsed JSON body, still untrusted.
   * @throws WebError `WEB_ABORTED` or `WEB_PROVIDER_ERROR`.
   */
  async post(path: string, body: unknown, apiKey: string, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal)
    let response: Response
    try {
      response = await this.options.fetch(endpointURL(this.options.baseURL, path), {
        method: "POST",
        redirect: "error",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error)
      throw providerError(
        `Exa request failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    }

    throwIfAborted(signal)
    if (!response.ok) throw await httpError(response, signal)
    try {
      return (await response.json()) as unknown
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error)
      throw providerError("Exa returned a response that is not valid JSON", error)
    }
  }
}
