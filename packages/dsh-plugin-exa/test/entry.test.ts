import type { WebFetchProvider, WebSearchProvider } from "@deepseek-ai/dsh-web"
import { describe, expect, it } from "vitest"
import type { ExaConfig, ExaOptions, VolatileValue } from "../src/contract"
import { snapshotOptions } from "../src/host/options"
import { apply, Config, inject, name } from "../src/index"

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
    apiKeyEnv: { get: () => value.apiKeyEnv } satisfies VolatileValue<string>,
    baseURL: { get: () => value.baseURL } satisfies VolatileValue<string>,
    searchType: { get: () => value.searchType } satisfies VolatileValue<ExaOptions["searchType"]>,
    searchContents: {
      get: () => value.searchContents,
    } satisfies VolatileValue<ExaOptions["searchContents"]>,
    searchMaxCharacters: { get: () => value.searchMaxCharacters } satisfies VolatileValue<number>,
    includeDomains: {
      get: () => value.includeDomains,
    } satisfies VolatileValue<readonly string[]>,
    excludeDomains: {
      get: () => value.excludeDomains,
    } satisfies VolatileValue<readonly string[]>,
    fetchMaxCharacters: { get: () => value.fetchMaxCharacters } satisfies VolatileValue<number>,
  }
}

interface Registration {
  search?: WebSearchProvider
  fetch?: WebFetchProvider
}

interface ConfigureCall {
  readonly presentation: { auto?: boolean }
  readonly owner: unknown
}

function createContext() {
  const registered: Registration = {}
  const injected: string[][] = []
  const configures: ConfigureCall[] = []
  const warnings: string[] = []
  const disposers: (() => void)[] = []
  const settings = {
    configure(presentation: { auto?: boolean }, owner?: unknown) {
      configures.push({ presentation, owner })
      return () => {}
    },
  }
  const child = {
    settings,
    effect(run: () => (() => void) | undefined) {
      const dispose = run()
      if (dispose !== undefined) disposers.push(dispose)
      return dispose
    },
  }
  const ctx = {
    fiber: { id: "owning-fiber" },
    logger: {
      warn: (message: string) => warnings.push(message),
      info: () => {},
    },
    credentials: {
      resolve: async () => ({ value: "secret-key", source: "file" }),
      describe: async () => ({ configured: true, writable: true }),
    },
    web: {
      registerSearchProvider(provider: WebSearchProvider) {
        registered.search = provider
        return () => {}
      },
      registerFetchProvider(provider: WebFetchProvider) {
        registered.fetch = provider
        return () => {}
      },
    },
    inject(dependencies: string[], callback: (scope: typeof child) => void) {
      injected.push(dependencies)
      callback(child)
    },
  }
  return {
    ctx,
    registered,
    injected,
    configures,
    warnings,
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

describe("exa host entry", () => {
  it("declares the plugin name and the services it needs", () => {
    expect(name).toBe("exa")
    expect(inject).toEqual(["web", "credentials"])
  })

  it("defines the documented defaults", () => {
    const parsed = Config({})

    expect(snapshotOptions(parsed)).toEqual({
      apiKeyEnv: "EXA_API_KEY",
      baseURL: "https://api.exa.ai",
      searchType: "auto",
      searchContents: "highlights",
      searchMaxCharacters: 1000,
      includeDomains: [],
      excludeDomains: [],
      fetchMaxCharacters: 100000,
    })
  })

  it("rejects an invalid credential name and out-of-range numbers", () => {
    expect(() => Config({ apiKeyEnv: "1BAD" })).toThrow()
    expect(() => Config({ apiKeyEnv: "has-dash" })).toThrow()
    expect(() => Config({ searchMaxCharacters: 50 })).toThrow()
    expect(() => Config({ searchMaxCharacters: 20001 })).toThrow()
    expect(() => Config({ fetchMaxCharacters: 999 })).toThrow()
    expect(() => Config({ fetchMaxCharacters: 1000001 })).toThrow()
    expect(() => Config({ searchType: "instant" as never })).toThrow()
    expect(() => Config({ searchContents: "summary" as never })).toThrow()
  })

  it("registers the exa search and fetch providers", async () => {
    const harness = createContext()

    apply(harness.ctx as never, config())

    expect(harness.registered.search?.id).toBe("exa")
    expect(harness.registered.fetch?.id).toBe("exa")
    expect(harness.registered.search?.available()).toBe(true)
    expect(harness.registered.fetch?.available()).toBe(true)
    await expect(harness.registered.search?.ready?.(undefined)).resolves.toBe(true)
    await expect(harness.registered.fetch?.ready?.(undefined)).resolves.toBe(true)
  })

  it("turns off the generated settings form because the plugin ships its own page", () => {
    const harness = createContext()

    apply(harness.ctx as never, config())

    expect(harness.injected).toEqual([["settings"]])
    expect(harness.configures).toEqual([
      { presentation: { auto: false }, owner: harness.ctx.fiber },
    ])
  })
})
