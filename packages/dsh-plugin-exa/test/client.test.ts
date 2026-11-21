import { WebError } from "@deepseek-ai/dsh-web"
import { describe, expect, it } from "vitest"
import type { FetchLike } from "../src/contract"
import { ExaClient } from "../src/host/client"

interface Call {
  readonly url: string
  readonly init: RequestInit
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function recordingFetch(respond: (url: string, init: RequestInit) => Promise<Response>): {
  fetch: FetchLike
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return respond(url, init)
    },
  }
}

function client(fetch: FetchLike, baseURL = "https://api.exa.ai"): ExaClient {
  return new ExaClient({ baseURL, fetch })
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

describe("ExaClient", () => {
  it("posts a JSON body to the endpoint with the Exa key header", async () => {
    const { fetch, calls } = recordingFetch(async () => jsonResponse({ results: [] }))
    const body = { query: "harness", numResults: 3 }

    await client(fetch, "https://api.exa.ai/").post("/search", body, "secret-key")

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.exa.ai/search")
    expect(calls[0]?.init.method).toBe("POST")
    expect(calls[0]?.init.redirect).toBe("error")
    expect(calls[0]?.init.body).toBe(JSON.stringify(body))
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe("secret-key")
    expect(headers["content-type"]).toBe("application/json")
  })

  it("passes the caller signal to fetch", async () => {
    const { fetch, calls } = recordingFetch(async () => jsonResponse({ ok: true }))
    const controller = new AbortController()

    await client(fetch).post("/contents", {}, "key", controller.signal)

    expect(calls[0]?.init.signal).toBe(controller.signal)
  })

  it("names the status, Exa error and tag on 401 and points at Settings", async () => {
    const { fetch } = recordingFetch(async () =>
      jsonResponse({ requestId: "r1", error: "Invalid API key", tag: "INVALID_API_KEY" }, 401),
    )

    const error = await rejectionOf(client(fetch).post("/search", {}, "secret-key"))

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("HTTP 401")
    expect(error.message).toContain("Invalid API key")
    expect(error.message).toContain("INVALID_API_KEY")
    expect(error.message).toContain("Settings > Exa")
    expect(error.message).not.toContain("secret-key")
  })

  it("explains out of credits and rate limits", async () => {
    const credits = await rejectionOf(
      client(
        recordingFetch(async () => jsonResponse({ error: "No credits", tag: "NO_CREDITS" }, 402))
          .fetch,
      ).post("/search", {}, "key"),
    )
    const rate = await rejectionOf(
      client(
        recordingFetch(async () => jsonResponse({ error: "Too many", tag: "RATE_LIMITED" }, 429))
          .fetch,
      ).post("/search", {}, "key"),
    )

    expect(credits.message).toContain("no credits")
    expect(rate.message).toContain("Retry later")
  })

  it("reports an unexplained status without a hint", async () => {
    const error = await rejectionOf(
      client(recordingFetch(async () => jsonResponse({ error: "Boom" }, 500)).fetch).post(
        "/search",
        {},
        "key",
      ),
    )

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("HTTP 500")
    expect(error.message).toContain("Boom")
    expect(error.message).not.toContain("Settings > Exa")
  })

  it("keeps the status when an error body is not JSON", async () => {
    const error = await rejectionOf(
      client(
        recordingFetch(async () => new Response("<html>bad</html>", { status: 502 })).fetch,
      ).post("/search", {}, "key"),
    )

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("HTTP 502")
  })

  it("rejects a success body that is not JSON", async () => {
    const error = await rejectionOf(
      client(recordingFetch(async () => new Response("not json", { status: 200 })).fetch).post(
        "/search",
        {},
        "key",
      ),
    )

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("not valid JSON")
  })

  it("maps a network failure to a provider error", async () => {
    const error = await rejectionOf(
      client(
        recordingFetch(async () => {
          throw new TypeError("fetch failed")
        }).fetch,
      ).post("/search", {}, "key"),
    )

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("fetch failed")
  })

  it("does not dispatch an already aborted request", async () => {
    const { fetch, calls } = recordingFetch(async () => jsonResponse({}))
    const controller = new AbortController()
    controller.abort()

    const error = await rejectionOf(client(fetch).post("/search", {}, "key", controller.signal))

    expect(error.code).toBe("WEB_ABORTED")
    expect(calls).toHaveLength(0)
  })

  it("maps an abort during dispatch to WEB_ABORTED", async () => {
    const { fetch } = recordingFetch(async () => {
      throw new DOMException("The operation was aborted.", "AbortError")
    })

    const error = await rejectionOf(client(fetch).post("/search", {}, "key"))

    expect(error.code).toBe("WEB_ABORTED")
  })
})
