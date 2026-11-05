import { AssistantStreamAccumulator } from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import { isLosslessJson } from "../../src/response/lossless"

function dshKeeps(value: unknown): boolean {
  try {
    new AssistantStreamAccumulator().push({
      time: 0,
      chunk: {
        type: "finish",
        reason: { kind: "stop" },
        replayState: { response: value },
      } as never,
    })
    return true
  } catch {
    return false
  }
}

class Custom {
  readonly a = 1
}

const sparse = new Array<number>(3)
const cyclic: Record<string, unknown> = {}
cyclic.self = cyclic
const hidden = Object.defineProperty({}, "secret", { value: 1, enumerable: false })
const symbolic = { [Symbol("tag")]: 1 }

describe("isLosslessJson", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["a string with a lone surrogate", "\ud800"],
    ["a boolean", true],
    ["zero", 0],
    ["a negative number", -1.5],
    ["negative zero", -0],
    ["infinity", Number.POSITIVE_INFINITY],
    ["not a number", Number.NaN],
    ["undefined", undefined],
    ["a function", () => 1],
    ["a bigint", 1n],
    ["a symbol", Symbol("x")],
    ["a nested ordinary value", { a: [1, { b: "c", d: null }], e: true }],
    ["negative zero deep inside", { a: [{ b: [-0] }] }],
    ["infinity deep inside", { a: { b: Number.NEGATIVE_INFINITY } }],
    ["an undefined property", { a: undefined }],
    ["a sparse array", sparse],
    ["a class instance", new Custom()],
    ["a date", new Date(0)],
    ["a null-prototype object", Object.assign(Object.create(null), { a: 1 })],
    ["a cycle", cyclic],
    ["a hidden property", hidden],
    ["a symbol key", symbolic],
    ["a __proto__ key", JSON.parse('{"__proto__": {"a": 1}}')],
  ])("agrees with DSH about %s", (_name, value) => {
    expect(isLosslessJson(value)).toBe(dshKeeps(value))
  })
})
