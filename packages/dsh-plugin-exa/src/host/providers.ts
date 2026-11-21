import { credentialRef } from "@deepseek-ai/dsh-credentials"
import type { WebFetchProvider, WebSearchProvider } from "@deepseek-ai/dsh-web"
import type { CredentialPort, ExaOptions, FetchLike, LoggerPort } from "../contract"
import { isHttpURL } from "../shared/url"
import { ExaClient } from "./client"
import {
  abortable,
  abortedError,
  credentialMissingError,
  credentialResolutionError,
  isAbortError,
  throwIfAborted,
} from "./errors"
import { mapContentsResponse, mapSearchResponse } from "./map"
import { buildContentsBody, buildSearchBody } from "./request"

/** Stable id both providers register under. */
export const PROVIDER_ID = "exa"

/** Everything the providers need from the Host and from the caller. */
export interface ProviderPorts {
  readonly credentials: CredentialPort
  readonly logger: LoggerPort
  readonly fetch: FetchLike
  /** A fresh option snapshot for the operation that is starting. */
  readonly options: () => ExaOptions
}

async function credentialReady(ports: ProviderPorts): Promise<boolean> {
  const options = ports.options()
  try {
    const info = await ports.credentials.describe(credentialRef(options.apiKeyEnv))
    return info.configured
  } catch {
    return false
  }
}

async function resolveApiKey(
  ports: ProviderPorts,
  options: ExaOptions,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const ref = credentialRef(options.apiKeyEnv)
  let resolved: { readonly value: string; readonly source: string } | undefined
  try {
    resolved = await abortable(ports.credentials.resolve(ref), signal)
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error)
    throw credentialResolutionError(error)
  }
  throwIfAborted(signal)
  if (resolved === undefined || resolved.value.length === 0) {
    throw credentialMissingError(options.apiKeyEnv)
  }
  return resolved.value
}

function clientFor(ports: ProviderPorts, options: ExaOptions): ExaClient {
  return new ExaClient({ baseURL: options.baseURL, fetch: ports.fetch })
}

/** Create the Exa provider for the search half of the web seam. */
export function createSearchProvider(ports: ProviderPorts): WebSearchProvider {
  return {
    id: PROVIDER_ID,
    available: () => isHttpURL(ports.options().baseURL),
    ready: () => credentialReady(ports),
    search: async (request, signal) => {
      const options = ports.options()
      const apiKey = await resolveApiKey(ports, options, signal)
      const payload = await clientFor(ports, options).post(
        "/search",
        buildSearchBody(request, options),
        apiKey,
        signal,
      )
      const mapped = mapSearchResponse(payload, options)
      for (const warning of mapped.warnings) ports.logger.warn(warning)
      return mapped.result
    },
  }
}

/** Create the Exa provider for the fetch half of the web seam. */
export function createFetchProvider(ports: ProviderPorts): WebFetchProvider {
  return {
    id: PROVIDER_ID,
    available: () => isHttpURL(ports.options().baseURL),
    ready: () => credentialReady(ports),
    fetch: async (request, signal) => {
      const options = ports.options()
      const apiKey = await resolveApiKey(ports, options, signal)
      const payload = await clientFor(ports, options).post(
        "/contents",
        buildContentsBody(request, options),
        apiKey,
        signal,
      )
      return mapContentsResponse(payload, {
        url: request.url,
        maxCharacters: options.fetchMaxCharacters,
      })
    },
  }
}
