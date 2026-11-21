import { WebError } from "@deepseek-ai/dsh-web"
import { describe, expect, it } from "vitest"
import { mapContentsResponse, mapSearchResponse } from "../src/host/map"

function webErrorOf(run: () => unknown): WebError {
  try {
    run()
  } catch (error) {
    if (error instanceof WebError) return error
    throw error
  }
  throw new Error("the call did not throw a WebError")
}

describe("mapSearchResponse in highlights mode", () => {
  it("deduplicates sources, collapses excerpts and joins every highlight", () => {
    const mapped = mapSearchResponse(
      {
        results: [
          {
            url: "https://a.test/1",
            title: "First",
            publishedDate: "2026-01-02T00:00:00.000Z",
            highlights: ["  first\n highlight ", "second  highlight"],
          },
          { url: "https://a.test/1", title: "Duplicate" },
          { url: "https://b.test/2", title: "", highlights: [] },
          { title: "No URL" },
          { url: "", title: "Empty URL" },
          { url: "https://c.test/3", highlights: ["   "] },
        ],
        output: { content: "The answer." },
        notices: [
          { code: "RESTRICTIONS_RELAXED", path: "/query", message: "Domains were relaxed." },
        ],
      },
      { searchContents: "highlights" },
    )

    expect(mapped.result.sources).toEqual([
      {
        url: "https://a.test/1",
        title: "First",
        publishedAt: "2026-01-02T00:00:00.000Z",
        snippet: "first highlight",
        summary: "first highlight … second highlight",
      },
      { url: "https://b.test/2" },
      { url: "https://c.test/3" },
    ])
    expect(mapped.result.content).toBe("The answer.\n\nNotes from Exa:\n- Domains were relaxed.")
    expect(mapped.result.truncated).toBe(false)
  })

  it("keeps the first highlight when a later one is blank", () => {
    const mapped = mapSearchResponse(
      { results: [{ url: "https://a.test", highlights: ["kept", "   "] }] },
      { searchContents: "highlights" },
    )

    expect(mapped.result.sources[0]?.snippet).toBe("kept")
    expect(mapped.result.sources[0]?.summary).toBe("kept")
  })
})

describe("mapSearchResponse in text mode", () => {
  it("uses the collapsed text for the summary and a bounded snippet", () => {
    const text = "word ".repeat(70)
    const mapped = mapSearchResponse(
      { results: [{ url: "https://a.test", text }] },
      { searchContents: "text" },
    )
    const source = mapped.result.sources[0]

    expect(source?.summary).toBe(text.trim())
    expect(source?.snippet?.length).toBe(300)
    expect(source?.snippet?.endsWith("word…")).toBe(true)
  })

  it("does not add an ellipsis when the text fits", () => {
    const mapped = mapSearchResponse(
      { results: [{ url: "https://a.test", text: "  alpha\n beta  " }] },
      { searchContents: "text" },
    )

    expect(mapped.result.sources[0]?.summary).toBe("alpha beta")
    expect(mapped.result.sources[0]?.snippet).toBe("alpha beta")
  })

  it("skips empty text", () => {
    const mapped = mapSearchResponse(
      { results: [{ url: "https://a.test", text: "   " }] },
      { searchContents: "text" },
    )

    expect(mapped.result.sources[0]).toEqual({ url: "https://a.test" })
  })
})

describe("mapSearchResponse content and warnings", () => {
  it("reports only notices when there is no synthesized content", () => {
    const mapped = mapSearchResponse(
      {
        results: [],
        notices: [
          { message: "First note." },
          { code: "OTHER", path: "/x", message: "Second note." },
          { message: "" },
        ],
      },
      { searchContents: "highlights" },
    )

    expect(mapped.result.content).toBe("Notes from Exa:\n- First note.\n- Second note.")
  })

  it("ignores an object output content", () => {
    const mapped = mapSearchResponse(
      { results: [], output: { content: { structured: true } } },
      { searchContents: "highlights" },
    )

    expect(mapped.result.content).toBeUndefined()
  })

  it("formats every warning for the logger", () => {
    const mapped = mapSearchResponse(
      {
        results: [],
        warnings: [
          { code: "IGNORED_FIELD", path: "/startPublishedDate", message: "No effect." },
          { message: "Bare warning." },
          { code: "NO_MESSAGE" },
        ],
      },
      { searchContents: "highlights" },
    )

    expect(mapped.warnings).toEqual([
      "Exa warning IGNORED_FIELD at /startPublishedDate: No effect.",
      "Exa warning: Bare warning.",
    ])
  })

  it("rejects bodies that are not a search response", () => {
    expect(webErrorOf(() => mapSearchResponse(null, { searchContents: "highlights" })).code).toBe(
      "WEB_PROVIDER_ERROR",
    )
    expect(webErrorOf(() => mapSearchResponse({}, { searchContents: "highlights" })).code).toBe(
      "WEB_PROVIDER_ERROR",
    )
    expect(
      webErrorOf(() => mapSearchResponse({ results: "nope" }, { searchContents: "highlights" }))
        .code,
    ).toBe("WEB_PROVIDER_ERROR")
  })

  it("returns no sources for an empty result list", () => {
    const mapped = mapSearchResponse({ results: [] }, { searchContents: "highlights" })

    expect(mapped.result.sources).toEqual([])
    expect(mapped.result.content).toBeUndefined()
  })
})

describe("mapContentsResponse", () => {
  it("returns a non-2xx page as a result", () => {
    const result = mapContentsResponse(
      {
        results: [],
        statuses: [
          {
            id: "https://a.test/missing",
            status: "error",
            error: { tag: "NOT_FOUND", httpStatusCode: 404 },
          },
        ],
      },
      { url: "https://a.test/missing", maxCharacters: 1000 },
    )

    expect(result).toEqual({
      url: "https://a.test/missing",
      statusCode: 404,
      body: { kind: "text", content: "" },
      truncated: false,
    })
  })

  it("reports an error without a status code as a provider error", () => {
    const error = webErrorOf(() =>
      mapContentsResponse(
        {
          results: [],
          statuses: [
            {
              id: "https://a.test/blocked",
              status: "error",
              error: { tag: "CRAWL_NOT_FOUND" },
            },
          ],
        },
        { url: "https://a.test/blocked", maxCharacters: 1000 },
      ),
    )

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("https://a.test/blocked")
    expect(error.message).toContain("CRAWL_NOT_FOUND")
  })

  it("marks a body cut at the fetch limit as truncated", () => {
    const result = mapContentsResponse(
      {
        results: [
          {
            id: "doc-1",
            url: "https://a.test/page",
            text: "abcdefghij",
          },
        ],
        statuses: [{ id: "https://a.test/page", status: "success" }],
      },
      { url: "https://a.test/page", maxCharacters: 5 },
    )

    expect(result.url).toBe("https://a.test/page")
    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ kind: "text", content: "abcde" })
    expect(result.truncated).toBe(true)
  })

  it("keeps the exact text when it fits", () => {
    const result = mapContentsResponse(
      {
        results: [{ url: "https://a.test/page", text: "hello" }],
        statuses: [{ id: "https://a.test/page", status: "success" }],
      },
      { url: "https://a.test/page", maxCharacters: 5 },
    )

    expect(result.body).toEqual({ kind: "text", content: "hello" })
    expect(result.truncated).toBe(false)
  })

  it("matches a result by id when there is a single result", () => {
    const result = mapContentsResponse(
      { results: [{ id: "https://a.test/page", url: "https://a.test/final", text: "ok" }] },
      { url: "https://a.test/page", maxCharacters: 100 },
    )

    expect(result.url).toBe("https://a.test/final")
    expect(result.body).toEqual({ kind: "text", content: "ok" })
  })

  it("fails when no result matches the requested URL", () => {
    const error = webErrorOf(() =>
      mapContentsResponse(
        {
          results: [
            { url: "https://b.test/other", text: "other" },
            { url: "https://c.test/third", text: "third" },
          ],
        },
        { url: "https://a.test/page", maxCharacters: 100 },
      ),
    )

    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain("https://a.test/page")
  })

  it("fails for a body with no results list", () => {
    expect(
      webErrorOf(() =>
        mapContentsResponse({ statuses: [] }, { url: "https://a.test", maxCharacters: 100 }),
      ).code,
    ).toBe("WEB_PROVIDER_ERROR")
  })
})
