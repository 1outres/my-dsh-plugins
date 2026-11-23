import { describe, expect, it } from "vitest"
import { AdvisorError, classifyFailureCode } from "../src/host/errors"

describe("classifyFailureCode", () => {
  it.each([
    ["CONTEXT_WINDOW_EXCEEDED", "prompt_too_long"],
    ["RATE_LIMIT", "too_many_requests"],
    ["QUOTA", "too_many_requests"],
    ["ACCOUNT_QUOTA", "too_many_requests"],
    ["SERVER", "overloaded"],
    ["HTTP_503", "overloaded"],
    ["HTTP_529", "overloaded"],
    ["TIMEOUT", "execution_time_exceeded"],
    ["UNKNOWN_MODEL", "model_not_found"],
    ["MODEL_UNSUPPORTED", "model_not_found"],
    ["NO_ADAPTER", "model_not_found"],
    ["AUTH", "unavailable"],
    ["HTTP_400", "unavailable"],
  ] as const)("maps %s to %s", (code, expected) => {
    expect(classifyFailureCode(code)).toBe(expected)
  })
})

describe("AdvisorError", () => {
  it("carries its code and tells the agent to go on without advice", () => {
    const error = new AdvisorError("overloaded", "the server is busy")
    expect(error.code).toBe("overloaded")
    expect(error.name).toBe("AdvisorError")
    expect(error.message).toBe(
      "Advisor unavailable (overloaded): the server is busy. Continue the task without advice.",
    )
  })
})
