import { describe, expect, it } from "vitest"
import type { ExaConfig, ExaOptions } from "../src/contract"
import { endpointURL, snapshotOptions } from "../src/host/options"
import { isHttpURL } from "../src/shared/url"

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

function config(overrides: Partial<ExaOptions> = {}): ExaConfig {
  const value = options(overrides)
  return {
    apiKeyEnv: { get: () => value.apiKeyEnv },
    baseURL: { get: () => value.baseURL },
    searchType: { get: () => value.searchType },
    searchContents: { get: () => value.searchContents },
    searchMaxCharacters: { get: () => value.searchMaxCharacters },
    includeDomains: { get: () => value.includeDomains },
    excludeDomains: { get: () => value.excludeDomains },
    fetchMaxCharacters: { get: () => value.fetchMaxCharacters },
  }
}

describe("snapshotOptions", () => {
  it("reads every volatile field once", () => {
    expect(snapshotOptions(config())).toEqual(options())
  })

  it("detaches the domain lists from the live references", () => {
    const include = ["a.test"]
    const snapshot = snapshotOptions(config({ includeDomains: include }))
    include.push("b.test")

    expect(snapshot.includeDomains).toEqual(["a.test"])
  })
})

describe("isHttpURL", () => {
  it("accepts only http and https URLs", () => {
    expect(isHttpURL("https://api.exa.ai")).toBe(true)
    expect(isHttpURL("http://localhost:8080/exa")).toBe(true)
    expect(isHttpURL("ftp://api.exa.ai")).toBe(false)
    expect(isHttpURL("api.exa.ai")).toBe(false)
    expect(isHttpURL("")).toBe(false)
  })
})

describe("endpointURL", () => {
  it("joins a base URL and a path without double slashes", () => {
    expect(endpointURL("https://api.exa.ai", "/search")).toBe("https://api.exa.ai/search")
    expect(endpointURL("https://api.exa.ai/", "/search")).toBe("https://api.exa.ai/search")
    expect(endpointURL("https://api.exa.ai///", "search")).toBe("https://api.exa.ai/search")
  })
})
