import { describe, expect, it } from "vitest"
import { Config, isAdvisorConfigured, readAdvisorSettings } from "../src/config"
import type { AdvisorConfig } from "../src/contract"
import { AdvisorError } from "../src/host/errors"

interface Values {
  provider: string
  model: string
  reasoningEffort: string
  adviceWordLimit: number
  timeoutMs: number
}

const DEFAULTS: Values = {
  provider: "",
  model: "",
  reasoningEffort: "",
  adviceWordLimit: 150,
  timeoutMs: 300000,
}

function live(values: Partial<Values>): AdvisorConfig {
  const value = { ...DEFAULTS, ...values }
  return {
    provider: { get: () => value.provider },
    model: { get: () => value.model },
    reasoningEffort: { get: () => value.reasoningEffort },
    adviceWordLimit: { get: () => value.adviceWordLimit },
    timeoutMs: { get: () => value.timeoutMs },
  }
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof AdvisorError) return error.code
    throw error
  }
  return undefined
}

describe("advisor config schema", () => {
  it("starts with no advisor model and the documented limits", () => {
    const parsed = Config({})
    expect(isAdvisorConfigured(parsed)).toBe(false)
    expect(parsed.adviceWordLimit.get()).toBe(150)
    expect(parsed.timeoutMs.get()).toBe(300000)
  })

  it("rejects limits outside their ranges", () => {
    expect(() => Config({ adviceWordLimit: 10 })).toThrow()
    expect(() => Config({ adviceWordLimit: 2001 })).toThrow()
    expect(() => Config({ timeoutMs: 999 })).toThrow()
  })
})

describe("isAdvisorConfigured", () => {
  it("is off while both provider and model are empty", () => {
    expect(isAdvisorConfigured(live({}))).toBe(false)
    expect(isAdvisorConfigured(live({ provider: "  ", model: " " }))).toBe(false)
  })

  it("is on as soon as either field is set, so a half-set route fails loud", () => {
    expect(isAdvisorConfigured(live({ provider: "claude" }))).toBe(true)
    expect(isAdvisorConfigured(live({ model: "opus" }))).toBe(true)
  })
})

describe("readAdvisorSettings", () => {
  it("reads one trimmed route and the limits", () => {
    expect(
      readAdvisorSettings(
        live({ provider: " claude ", model: " opus ", adviceWordLimit: 80, timeoutMs: 5000 }),
      ),
    ).toEqual({
      route: { provider: "claude", model: "opus" },
      adviceWordLimit: 80,
      timeoutMs: 5000,
    })
  })

  it("keeps a reasoning effort only when one is set", () => {
    expect(
      readAdvisorSettings(live({ provider: "claude", model: "opus", reasoningEffort: " high " }))
        .route,
    ).toEqual({ provider: "claude", model: "opus", reasoningEffort: "high" })
  })

  it("refuses a route that names only a provider or only a model", () => {
    expect(codeOf(() => readAdvisorSettings(live({ provider: "claude" })))).toBe("invalid_config")
    expect(codeOf(() => readAdvisorSettings(live({ model: "opus" })))).toBe("invalid_config")
    expect(codeOf(() => readAdvisorSettings(live({})))).toBe("invalid_config")
  })
})
