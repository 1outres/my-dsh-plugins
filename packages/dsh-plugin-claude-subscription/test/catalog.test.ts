import { describe, expect, it } from "vitest"
import {
  ACCESS_GATED,
  ALIASES,
  acceptsThinkingDisable,
  CONTEXT_WINDOWS,
  contextWindowOf,
  nativeModel,
  PICKER_ROUTES,
  supportsAdaptiveThinking,
} from "../src/catalog"
import { FailureCode, NativeFailure } from "../src/errors"

const PINNED_ROUTES = {
  "claude-sonnet-5-5[1m]": 1_000_000,
  "claude-sonnet-5[1m]": 1_000_000,
  "claude-haiku-5-5[1m]": 1_000_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-5-5[1m]": 1_000_000,
  "claude-opus-5[1m]": 1_000_000,
  "claude-opus-4-8[1m]": 1_000_000,
  "claude-fable-5-1[1m]": 1_000_000,
}

const GATED_ROUTES = { "claude-mythos-5-1[1m]": 1_000_000 }

describe("pinned routes", () => {
  it("lists every route an account may be offered, without access-gated ones", () => {
    expect(new Set(PICKER_ROUTES)).toEqual(new Set(Object.keys(PINNED_ROUTES)))
  })

  it("keeps the access-gated model out of the picker routes", () => {
    expect(ACCESS_GATED.has("claude-mythos-5-1")).toBe(true)
    expect(PICKER_ROUTES).not.toContain("claude-mythos-5-1[1m]")
  })

  it("reports the pinned window for every route", () => {
    for (const [route, window] of Object.entries({ ...PINNED_ROUTES, ...GATED_ROUTES })) {
      expect(contextWindowOf(route), route).toBe(window)
    }
  })

  it("reports the pinned window for canonical ids and aliases", () => {
    for (const id of Object.keys(CONTEXT_WINDOWS)) {
      expect(contextWindowOf(id), id).toBe(CONTEXT_WINDOWS[id])
    }
    for (const [alias, target] of Object.entries(ALIASES)) {
      expect(contextWindowOf(alias), alias).toBe(CONTEXT_WINDOWS[target])
    }
  })

  it("reports 200K for an unpinned plain id and nothing for an unpinned [1m] id", () => {
    expect(contextWindowOf("unqualified-future-model")).toBe(200_000)
    expect(contextWindowOf("unqualified-future-model[1m]")).toBeUndefined()
  })
})

describe("nativeModel", () => {
  it("keeps pinned routes and resolves every spelling to the route the CLI is given", () => {
    const expected: Record<string, string> = {
      ...Object.fromEntries(Object.keys({ ...PINNED_ROUTES, ...GATED_ROUTES }).map((r) => [r, r])),
      sonnet: "claude-sonnet-5-5[1m]",
      "sonnet-5-5": "claude-sonnet-5-5[1m]",
      "sonnet-5.5": "claude-sonnet-5-5[1m]",
      opus: "claude-opus-5-5[1m]",
      "opus-5-5": "claude-opus-5-5[1m]",
      haiku: "claude-haiku-5-5[1m]",
      "haiku-5.5": "claude-haiku-5-5[1m]",
      "claude-haiku-4-5": "claude-haiku-4-5-20251001",
      "haiku-4-5": "claude-haiku-4-5-20251001",
      "haiku-4.5": "claude-haiku-4-5-20251001",
      "opus-4.8": "claude-opus-4-8[1m]",
      fable: "claude-fable-5-1[1m]",
      "claude-mythos-5-1": "claude-mythos-5-1[1m]",
      "mythos-5.1": "claude-mythos-5-1[1m]",
      "unqualified-future-model": "unqualified-future-model",
    }
    for (const [requested, route] of Object.entries(expected)) {
      expect(nativeModel(requested), requested).toBe(route)
    }
  })

  it("adds [1m] only for ids pinned at 1M and sends an unpinned id as typed", () => {
    expect(nativeModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5[1m]")
    expect(nativeModel("claude-opus-9")).toBe("claude-opus-9")
    expect(nativeModel("claude-opus-9[1m]")).toBe("claude-opus-9[1m]")
  })

  it("refuses a 1M window for Haiku 4.5", () => {
    expect(() => nativeModel("claude-haiku-4-5-20251001[1m]")).toThrow(NativeFailure)
    try {
      nativeModel("claude-haiku-4-5[1m]")
    } catch (error) {
      expect((error as NativeFailure).code).toBe(FailureCode.invalidRequest)
    }
  })
})

describe("thinking policy", () => {
  const mandatory = [
    "sonnet",
    "sonnet-5-5",
    "sonnet-5.5",
    "claude-sonnet-5-5",
    "claude-sonnet-5-5[1m]",
    "haiku",
    "haiku-5.5",
    "claude-haiku-5-5[1m]",
    "opus",
    "claude-opus-5-5",
    "claude-opus-5-5[1m]",
    "fable",
    "claude-fable-5-1[1m]",
    "claude-mythos-5-1",
    "claude-mythos-5-1[1m]",
    "claude-mythos-5",
  ]
  const disableAccepted = [
    "claude-sonnet-5",
    "claude-sonnet-5[1m]",
    "claude-opus-5",
    "claude-opus-5[1m]",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "haiku-4-5",
    "haiku-4.5",
  ]

  it("rejects the disable on routes where thinking cannot be turned off", () => {
    for (const route of mandatory) {
      expect(acceptsThinkingDisable(route), route).toBe(false)
    }
  })

  it("accepts the disable on routes that still take it", () => {
    for (const route of disableAccepted) {
      expect(acceptsThinkingDisable(route), route).toBe(true)
    }
  })

  it("does not take the Opus 5.5 gate for plain Opus 5 by prefix", () => {
    expect(acceptsThinkingDisable("claude-opus-5")).toBe(true)
    expect(acceptsThinkingDisable("claude-opus-5-5")).toBe(false)
  })

  it("denies adaptive thinking to Haiku 4.5 only", () => {
    for (const route of [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "haiku-4-5",
      "haiku-4.5",
    ]) {
      expect(supportsAdaptiveThinking(route), route).toBe(false)
    }
    for (const route of [
      "sonnet",
      "claude-sonnet-5-5",
      "haiku",
      "claude-haiku-5-5[1m]",
      "opus",
      "fable",
      "claude-future-9",
    ]) {
      expect(supportsAdaptiveThinking(route), route).toBe(true)
    }
  })
})
