import { describe, expect, it } from "vitest"
import { PROVIDER_ID } from "../../src/contract"
import { modelInfo } from "../../src/request/model-info"

const effortIds = (model: string) =>
  modelInfo(PROVIDER_ID, model).reasoning?.efforts.map((effort) => effort.id)

describe("modelInfo", () => {
  it("describes the route", () => {
    const info = modelInfo(PROVIDER_ID, "claude-opus-5-5[1m]")
    expect(info).toMatchObject({
      provider: PROVIDER_ID,
      id: "claude-opus-5-5[1m]",
      inputModalities: ["text", "image"],
    })
    expect(info.name).toBeTruthy()
  })

  it("reports the pinned window of a pinned route", () => {
    expect(modelInfo(PROVIDER_ID, "claude-sonnet-5-5[1m]").context).toEqual({
      contextWindow: 1_000_000,
    })
    expect(modelInfo(PROVIDER_ID, "sonnet").context).toEqual({ contextWindow: 1_000_000 })
    expect(modelInfo(PROVIDER_ID, "claude-haiku-4-5-20251001").context).toEqual({
      contextWindow: 200_000,
    })
  })

  it("reports 200K for an unpinned plain id and no window for an unpinned [1m] id", () => {
    expect(modelInfo(PROVIDER_ID, "unqualified-future-model").context).toEqual({
      contextWindow: 200_000,
    })
    expect(modelInfo(PROVIDER_ID, "unqualified-future-model[1m]")).not.toHaveProperty("context")
  })

  it("lists off only where the route can disable thinking", () => {
    expect(effortIds("claude-sonnet-5")).toEqual(["off", "low", "medium", "high", "xhigh", "max"])
    expect(effortIds("claude-haiku-4-5")).toEqual(["off", "low", "medium", "high", "xhigh", "max"])
    expect(effortIds("claude-sonnet-5-5")).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(effortIds("fable")).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("names every effort and sets no default", () => {
    const reasoning = modelInfo(PROVIDER_ID, "claude-sonnet-5").reasoning
    expect(reasoning?.efforts.map((effort) => effort.name)).toEqual([
      "Off",
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
    ])
    expect(reasoning).not.toHaveProperty("defaultEffort")
  })

  it("asks DSH for the full tool list on every call", () => {
    const info = modelInfo(PROVIDER_ID, "sonnet")
    expect(info).not.toHaveProperty("systemPromptUpdate")
    expect(info).not.toHaveProperty("toolUpdate")
  })
})
