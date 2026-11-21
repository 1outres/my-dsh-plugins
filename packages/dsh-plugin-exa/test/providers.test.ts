import { WebError } from "@deepseek-ai/dsh-web"
import { describe, expect, it } from "vitest"
import type {
  CredentialDescription,
  CredentialPort,
  ExaOptions,
  FetchLike,
  LoggerPort,
} from "../src/contract"
import { createFetchProvider, createSearchProvider, PROVIDER_ID } from "../src/host/providers"

function options(overrides: Partial<ExaOptions> = {}): ExaOptions {
  return {
    apiKeyEnv: "EXA_API_KEY",
    baseURL: "https://api.exa.ai",
    searchType: "auto",
    searchContents: "highlights",
    searchMaxCharacters: 1000,
    includeDomains: [],
    excludeDomains: [],
    fetchMaxCharacters: 100000,
    ...overrides,
  }
}

interface CredentialOptions {
  readonly resolved?: { readonly value: string; readonly source: string }
  readonly resolveError?: unknown
  readonly described?: CredentialDescription
  readonly describeError?: unknown
}

interface FakeCredentials extends CredentialPort {
  readonly resolvedRefs: string[]
  readonly describedRefs: string[]
}

function credentials(settings: CredentialOptions = {}): FakeCredentials {
  const resolvedRefs: string[] = []
  const describedRefs: string[] = []
  return {
    resolvedRefs,
    describedRefs,
    async resolve(ref) {
      resolvedRefs.push(String(ref))
      if (settings.resolveError !== undefined) throw settings.resolveError
      return settings.resolved
    },
    async describe(ref) {
      describedRefs.push(String(ref))
      if (settings.describeError !== undefined) throw settings.describeError
      return settings.described ?? { configured: true, writable: true }
    },
  }
}

interface FakeFetch {
  readonly fetch: FetchLike
  readonly calls: { readonly url: string; readonly init: RequestInit }[]
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function fetchReturning(body: unknown): FakeFetch {
  const calls: { url: string; init: RequestInit }[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(body)
    },
  }
}

function logger(): LoggerPort & { readonly messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    warn: (message) => messages.push(message),
  }
}

async function rejectionOf(operation: Promise<unknown>): Promise<WebError> {
  try {
    await operation
  } catch (error) {
    if (error instanceof WebError) return error
    throw error
  }
  throw new Error("the operation did not throw a WebError")
}

describe("search provider", () => {
  it("registers under the exa id and is available only for an http base URL", () => {
    const available = createSearchProvider({
      credentials: credentials(),
      logger: logger(),
      fetch: fetchReturning({ results: [] }).fetch,
      options: () => options(),
    })
    const ftp = createSearchProvider({
      credentials: credentials(),
      logger: logger(),
      fetch: fetchReturning({ results: [] }).fetch,
      options: () => options({ baseURL: "ftp://api.exa.ai" }),
    })
    const broken = createSearchProvider({
      credentials: credentials(),
      logger: logger(),
      fetch: fetchReturning({ results: [] }).fetch,
      options: () => options({ baseURL: "not a URL" }),
    })

    expect(available.id).toBe(PROVIDER_ID)
    expect(available.available()).toBe(true)
    expect(ftp.available()).toBe(false)
    expect(broken.available()).toBe(false)
  })

  it("answers readiness from the credential store without calling fetch", async () => {
    const store = credentials({ described: { configured: true, writable: true } })
    const fetching = fetchReturning({ results: [] })
    const provider = createSearchProvider({
      credentials: store,
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options(),
    })

    await expect(provider.ready?.("route")).resolves.toBe(true)
    expect(store.describedRefs).toEqual(["EXA_API_KEY"])
    expect(fetching.calls).toHaveLength(0)

    const missing = createSearchProvider({
      credentials: credentials({ described: { configured: false, writable: true } }),
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options(),
    })
    await expect(missing.ready?.("route")).resolves.toBe(false)
  })

  it("answers not ready when the store throws", async () => {
    const provider = createSearchProvider({
      credentials: credentials({ describeError: new Error("store is broken") }),
      logger: logger(),
      fetch: fetchReturning({ results: [] }).fetch,
      options: () => options(),
    })

    await expect(provider.ready?.("route")).resolves.toBe(false)
  })

  it("snapshots options, sends the key, maps the answer and logs warnings", async () => {
    const store = credentials({ resolved: { value: "secret-key", source: "file" } })
    const fetching = fetchReturning({
      results: [{ url: "https://a.test/1", highlights: ["high"] }],
      warnings: [{ code: "IGNORED_FIELD", path: "/x", message: "No effect." }],
    })
    const log = logger()
    const provider = createSearchProvider({
      credentials: store,
      logger: log,
      fetch: fetching.fetch,
      options: () => options({ baseURL: "https://api.exa.ai/", searchContents: "highlights" }),
    })

    const result = await provider.search({ query: "harness", maxResults: 4 })

    expect(fetching.calls).toHaveLength(1)
    expect(fetching.calls[0]?.url).toBe("https://api.exa.ai/search")
    const headers = (fetching.calls[0]?.init.headers ?? {}) as Record<string, string>
    expect(headers["x-api-key"]).toBe("secret-key")
    expect(JSON.parse(String(fetching.calls[0]?.init.body))).toEqual({
      query: "harness",
      type: "auto",
      numResults: 4,
      contents: { highlights: { maxCharacters: 1000 } },
    })
    expect(result.sources).toEqual([{ url: "https://a.test/1", snippet: "high", summary: "high" }])
    expect(log.messages).toEqual(["Exa warning IGNORED_FIELD at /x: No effect."])
  })

  it("fails with a clear error when no key is stored", async () => {
    const fetching = fetchReturning({ results: [] })
    const provider = createSearchProvider({
      credentials: credentials(),
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options({ apiKeyEnv: "MY_EXA_KEY" }),
    })

    const error = await rejectionOf(provider.search({ query: "q" }))

    expect(error.code).toBe("WEB_PROVIDER_CREDENTIAL_MISSING")
    expect(error.message).toContain("Exa API key is not set")
    expect(error.message).toContain("Settings > Exa")
    expect(error.message).toContain("MY_EXA_KEY")
    expect(fetching.calls).toHaveLength(0)
  })

  it("wraps a failing credential store in a provider error", async () => {
    const provider = createSearchProvider({
      credentials: credentials({ resolveError: new Error("store is broken") }),
      logger: logger(),
      fetch: fetchReturning({ results: [] }).fetch,
      options: () => options(),
    })

    const error = await rejectionOf(provider.search({ query: "q" }))

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("Exa credential resolution failed: store is broken")
  })

  it("does not start a search for an already aborted request", async () => {
    const fetching = fetchReturning({ results: [] })
    const store = credentials({ resolved: { value: "key", source: "file" } })
    const provider = createSearchProvider({
      credentials: store,
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options(),
    })
    const controller = new AbortController()
    controller.abort()

    const error = await rejectionOf(provider.search({ query: "q" }, controller.signal))

    expect(error.code).toBe("WEB_ABORTED")
    expect(store.resolvedRefs).toEqual([])
    expect(fetching.calls).toHaveLength(0)
  })

  it("reads a fresh option snapshot for every operation", async () => {
    let current = options()
    const fetching = fetchReturning({ results: [] })
    const provider = createSearchProvider({
      credentials: credentials({ resolved: { value: "key", source: "file" } }),
      logger: logger(),
      fetch: fetching.fetch,
      options: () => current,
    })

    await provider.search({ query: "first" })
    current = options({ baseURL: "https://second.exa.test" })
    await provider.search({ query: "second" })

    expect(fetching.calls.map((call) => call.url)).toEqual([
      "https://api.exa.ai/search",
      "https://second.exa.test/search",
    ])
  })
})

describe("fetch provider", () => {
  it("registers under the exa id and posts one URL with the fetch limit plus one", async () => {
    const fetching = fetchReturning({
      results: [{ url: "https://a.test/page", text: "hello world" }],
      statuses: [{ id: "https://a.test/page", status: "success" }],
    })
    const provider = createFetchProvider({
      credentials: credentials({ resolved: { value: "key", source: "file" } }),
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options({ fetchMaxCharacters: 5 }),
    })

    expect(provider.id).toBe(PROVIDER_ID)
    expect(provider.available()).toBe(true)

    const result = await provider.fetch({ url: "https://a.test/page" })

    expect(fetching.calls[0]?.url).toBe("https://api.exa.ai/contents")
    expect(JSON.parse(String(fetching.calls[0]?.init.body))).toEqual({
      urls: ["https://a.test/page"],
      text: { maxCharacters: 6 },
    })
    expect(result).toEqual({
      url: "https://a.test/page",
      statusCode: 200,
      body: { kind: "text", content: "hello" },
      truncated: true,
    })
  })

  it("returns a non-2xx page as a fetch result", async () => {
    const provider = createFetchProvider({
      credentials: credentials({ resolved: { value: "key", source: "file" } }),
      logger: logger(),
      fetch: fetchReturning({
        results: [],
        statuses: [{ id: "https://a.test/gone", status: "error", error: { httpStatusCode: 410 } }],
      }).fetch,
      options: () => options(),
    })

    await expect(provider.fetch({ url: "https://a.test/gone" })).resolves.toEqual({
      url: "https://a.test/gone",
      statusCode: 410,
      body: { kind: "text", content: "" },
      truncated: false,
    })
  })

  it("fails clearly without a key and before an aborted fetch", async () => {
    const fetching = fetchReturning({ results: [] })
    const missing = createFetchProvider({
      credentials: credentials(),
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options(),
    })
    const aborted = createFetchProvider({
      credentials: credentials({ resolved: { value: "key", source: "file" } }),
      logger: logger(),
      fetch: fetching.fetch,
      options: () => options(),
    })
    const controller = new AbortController()
    controller.abort()

    await expect(missing.fetch({ url: "https://a.test" })).rejects.toMatchObject({
      code: "WEB_PROVIDER_CREDENTIAL_MISSING",
    })
    await expect(aborted.fetch({ url: "https://a.test" }, controller.signal)).rejects.toMatchObject(
      { code: "WEB_ABORTED" },
    )
    expect(fetching.calls).toHaveLength(0)
  })

  it("answers readiness from the credential store", async () => {
    const store = credentials({ described: { configured: false, writable: true } })
    const provider = createFetchProvider({
      credentials: store,
      logger: logger(),
      fetch: fetchReturning({}).fetch,
      options: () => options(),
    })

    await expect(provider.ready?.("route")).resolves.toBe(false)
    expect(store.describedRefs).toEqual(["EXA_API_KEY"])
  })
})
