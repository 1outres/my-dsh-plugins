import { describe, expect, it } from "vitest"
import type { ExaOptions } from "../src/contract"
import { buildContentsBody, buildSearchBody, numResultsFor } from "../src/host/request"

const options: ExaOptions = {
  apiKeyEnv: "EXA_API_KEY",
  baseURL: "https://api.exa.ai",
  searchType: "auto",
  searchContents: "highlights",
  searchMaxCharacters: 1000,
  includeDomains: [],
  excludeDomains: [],
  fetchMaxCharacters: 100000,
}

describe("buildSearchBody", () => {
  it("sends the query, type, ten results and highlight contents by default", () => {
    expect(buildSearchBody({ query: "harness" }, options)).toEqual({
      query: "harness",
      type: "auto",
      numResults: 10,
      contents: { highlights: { maxCharacters: 1000 } },
    })
  })

  it("uses the request result bound, clamped to 1..100", () => {
    expect(buildSearchBody({ query: "x", maxResults: 3 }, options).numResults).toBe(3)
    expect(buildSearchBody({ query: "x", maxResults: 0 }, options).numResults).toBe(1)
    expect(buildSearchBody({ query: "x", maxResults: -9 }, options).numResults).toBe(1)
    expect(buildSearchBody({ query: "x", maxResults: 500 }, options).numResults).toBe(100)
    expect(buildSearchBody({ query: "x", maxResults: 7.8 }, options).numResults).toBe(7)
    expect(numResultsFor(undefined)).toBe(10)
  })

  it("asks for text when that content mode is configured", () => {
    const body = buildSearchBody(
      { query: "x" },
      { ...options, searchContents: "text", searchMaxCharacters: 2500 },
    )

    expect(body.contents).toEqual({ text: { maxCharacters: 2500 } })
  })

  it("sends domain filters only when they have entries", () => {
    const body = buildSearchBody(
      { query: "x" },
      {
        ...options,
        includeDomains: ["example.com"],
        excludeDomains: ["spam.test"],
      },
    )

    expect(body.includeDomains).toEqual(["example.com"])
    expect(body.excludeDomains).toEqual(["spam.test"])

    const bare = buildSearchBody({ query: "x" }, options)
    expect("includeDomains" in bare).toBe(false)
    expect("excludeDomains" in bare).toBe(false)
  })

  it("passes the configured search type", () => {
    expect(buildSearchBody({ query: "x" }, { ...options, searchType: "deep" }).type).toBe("deep")
  })
})

describe("buildContentsBody", () => {
  it("asks for one more character than the fetch limit so truncation is visible", () => {
    expect(
      buildContentsBody({ url: "https://example.com/a" }, { ...options, fetchMaxCharacters: 5000 }),
    ).toEqual({
      urls: ["https://example.com/a"],
      text: { maxCharacters: 5001 },
    })
  })
})
