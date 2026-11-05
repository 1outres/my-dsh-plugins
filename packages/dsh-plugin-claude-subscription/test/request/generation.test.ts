import { describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { generationOf } from "../../src/request/generation"

const SUMMARIZED = { type: "adaptive", display: "summarized" }

function failureOf(run: () => unknown): NativeFailure {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(NativeFailure)
    return error as NativeFailure
  }
  throw new Error("expected the call to fail")
}

describe("reasoning off", () => {
  const cannotDisable = [
    "haiku",
    "claude-haiku-5-5[1m]",
    "sonnet",
    "sonnet-5-5",
    "sonnet-5.5",
    "claude-sonnet-5-5",
    "claude-sonnet-5-5[1m]",
    "opus",
    "claude-opus-5-5",
    "claude-opus-5-5[1m]",
    "fable",
    "claude-mythos-5-1",
    "claude-mythos-5-1[1m]",
    "claude-mythos-5",
  ]

  it.each(cannotDisable)(
    "asks for the lowest effort on %s, which cannot disable thinking",
    (model) => {
      const generation = generationOf({ model, reasoningEffort: "off" })
      expect(generation.body).not.toHaveProperty("thinking")
      expect(generation.body).not.toHaveProperty("context_management")
      expect(generation.body.output_config).toEqual({ effort: "low" })
      expect(generation.effort).toBe("low")
    },
  )

  it.each([
    "claude-sonnet-5",
    "claude-sonnet-5[1m]",
    "claude-opus-5",
    "claude-haiku-4-5",
    "haiku-4.5",
  ])("sends the real disable on %s", (model) => {
    const generation = generationOf({ model, reasoningEffort: "off" })
    expect(generation.body.thinking).toEqual({ type: "disabled" })
    expect(generation.body.context_management).toEqual({ edits: [] })
    expect(generation.body).not.toHaveProperty("output_config")
    expect(generation.effort).toBeUndefined()
  })
})

describe("reasoning on", () => {
  it.each([
    "sonnet",
    "claude-sonnet-5-5",
    "claude-sonnet-5-5[1m]",
    "haiku",
    "claude-haiku-5-5",
    "claude-haiku-5-5[1m]",
    "opus",
    "claude-opus-5-5",
    "claude-opus-5-5[1m]",
    "fable",
    "claude-fable-5-1",
    "claude-fable-5-1[1m]",
  ])("asks for summarized adaptive thinking on %s", (model) => {
    const generation = generationOf({ model, reasoningEffort: "medium" })
    expect(generation.body.thinking).toEqual(SUMMARIZED)
    expect(generation.body.output_config).toEqual({ effort: "medium" })
    expect(generation.effort).toBe("medium")
  })

  it("asks for summarized adaptive thinking when the request sets no effort", () => {
    const generation = generationOf({ model: "sonnet" })
    expect(generation.body.thinking).toEqual(SUMMARIZED)
    expect(generation.body).not.toHaveProperty("output_config")
    expect(generation.effort).toBeUndefined()
  })

  it.each(["low", "medium", "high", "xhigh", "max"])("passes the effort %s on", (effort) => {
    const generation = generationOf({ model: "opus", reasoningEffort: effort })
    expect(generation.body.output_config).toEqual({ effort })
    expect(generation.effort).toBe(effort)
  })

  it.each(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "haiku-4-5", "haiku-4.5"])(
    "never sends adaptive thinking to %s but keeps the effort",
    (model) => {
      const generation = generationOf({ model, reasoningEffort: "medium" })
      expect(generation.body).not.toHaveProperty("thinking")
      expect(generation.body.output_config).toEqual({ effort: "medium" })
    },
  )

  it("rejects an effort the route does not list", () => {
    const failure = failureOf(() => generationOf({ model: "opus", reasoningEffort: "minimal" }))
    expect(failure.code).toBe(FailureCode.invalidRequest)
  })
})

describe("sampling and limits", () => {
  it("drops a valid temperature, which subscription models reject", () => {
    const generation = generationOf({ model: "sonnet", temperature: 0.3 })
    expect(generation.body).not.toHaveProperty("temperature")
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    "rejects the temperature %s",
    (temperature) => {
      const failure = failureOf(() => generationOf({ model: "sonnet", temperature }))
      expect(failure.code).toBe(FailureCode.invalidRequest)
    },
  )

  it("sends the output limit in the body and as the CLI limit", () => {
    const generation = generationOf({ model: "sonnet", maxTokens: 17 })
    expect(generation.body.max_tokens).toBe(17)
    expect(generation.maxOutputTokens).toBe(17)
  })

  it.each([0, -1, 1.5, Number.NaN])("rejects the output limit %s", (maxTokens) => {
    const failure = failureOf(() => generationOf({ model: "sonnet", maxTokens }))
    expect(failure.code).toBe(FailureCode.invalidRequest)
  })

  it("sends no output limit when the request sets none", () => {
    const generation = generationOf({ model: "sonnet" })
    expect(generation.body).not.toHaveProperty("max_tokens")
    expect(generation.maxOutputTokens).toBeUndefined()
  })

  it("maps stop strings to stop_sequences", () => {
    expect(generationOf({ model: "sonnet", stop: ["END", "STOP"] }).body.stop_sequences).toEqual([
      "END",
      "STOP",
    ])
  })

  it("rejects an empty stop string", () => {
    const failure = failureOf(() => generationOf({ model: "sonnet", stop: ["END", ""] }))
    expect(failure.code).toBe(FailureCode.invalidRequest)
  })

  it("orders the body as reasoning, limit, then stop", () => {
    const generation = generationOf({
      model: "sonnet",
      reasoningEffort: "high",
      maxTokens: 9,
      stop: ["x"],
    })
    expect(Object.keys(generation.body)).toEqual([
      "thinking",
      "output_config",
      "max_tokens",
      "stop_sequences",
    ])
  })
})
