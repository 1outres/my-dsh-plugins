import { describe, expect, it } from "vitest"
import { parseLimit, readFormValues } from "../src/client/values"
import { ADVISOR_DEFAULTS } from "../src/shared/settings"

describe("readFormValues", () => {
  it("reads the Host section", () => {
    expect(
      readFormValues({
        provider: "claude",
        model: "opus",
        reasoningEffort: "high",
        adviceWordLimit: 80,
        timeoutMs: 5000,
      }),
    ).toEqual({
      provider: "claude",
      model: "opus",
      reasoningEffort: "high",
      adviceWordLimit: 80,
      timeoutMs: 5000,
    })
  })

  it("shows the schema defaults for fields the section does not carry", () => {
    expect(readFormValues(undefined)).toEqual(ADVISOR_DEFAULTS)
    expect(readFormValues({ provider: 1, adviceWordLimit: "x" })).toEqual(ADVISOR_DEFAULTS)
  })
})

describe("parseLimit", () => {
  it("accepts whole numbers inside the schema range", () => {
    expect(parseLimit("adviceWordLimit", " 80 ")).toBe(80)
    expect(parseLimit("adviceWordLimit", "20")).toBe(20)
    expect(parseLimit("adviceWordLimit", "2000")).toBe(2000)
    expect(parseLimit("timeoutMs", "1000")).toBe(1000)
  })

  it("refuses anything else", () => {
    expect(parseLimit("adviceWordLimit", "19")).toBeUndefined()
    expect(parseLimit("adviceWordLimit", "2001")).toBeUndefined()
    expect(parseLimit("adviceWordLimit", "1.5")).toBeUndefined()
    expect(parseLimit("adviceWordLimit", "")).toBeUndefined()
    expect(parseLimit("timeoutMs", "999")).toBeUndefined()
    expect(parseLimit("timeoutMs", "abc")).toBeUndefined()
  })
})
