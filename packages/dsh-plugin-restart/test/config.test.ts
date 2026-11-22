import { describe, expect, it } from "vitest"
import { Config, resolveConfig } from "../src/config"

describe("restart config", () => {
  it("defaults to the Creator presets, exit code 75 and a short window", () => {
    expect(Config({})).toEqual({
      presets: ["cordis", "creator-ptc"],
      exitCode: 75,
      resumeWithinMinutes: 10,
      forceExitAfterMs: 15000,
    })
  })

  it("keeps the values it is given", () => {
    expect(
      Config({ presets: ["ptc"], exitCode: 1, resumeWithinMinutes: 2, forceExitAfterMs: 500 }),
    ).toEqual({ presets: ["ptc"], exitCode: 1, resumeWithinMinutes: 2, forceExitAfterMs: 500 })
  })

  it("rejects an exit code outside 1..255", () => {
    expect(() => Config({ exitCode: 0 })).toThrow()
    expect(() => Config({ exitCode: 256 })).toThrow()
  })

  it("resolves its own copy of the presets", () => {
    const presets = ["cordis"]
    const resolved = resolveConfig(Config({ presets }))
    expect(resolved.presets).toEqual(["cordis"])
    expect(resolved.presets).not.toBe(presets)
  })

  it("refuses a preset list that cannot name a Creator preset", () => {
    const base = Config({})
    expect(() => resolveConfig({ ...base, presets: [] })).toThrow(/presets/)
    expect(() => resolveConfig({ ...base, presets: [""] })).toThrow(/presets/)
    expect(() => resolveConfig({ ...base, presets: [" "] })).toThrow(/presets/)
  })

  it("refuses values the schema never produced", () => {
    const base = Config({})
    expect(() => resolveConfig({ ...base, exitCode: 0 })).toThrow(/exitCode/)
    expect(() => resolveConfig({ ...base, resumeWithinMinutes: 0 })).toThrow(/resumeWithinMinutes/)
    expect(() => resolveConfig({ ...base, forceExitAfterMs: 1.5 })).toThrow(/forceExitAfterMs/)
  })
})
