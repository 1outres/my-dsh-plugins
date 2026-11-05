import { describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"

describe("NativeFailure request id", () => {
  const long = (count: number) => `req_${"a".repeat(count)}`

  it.each<[unknown, string | undefined]>([
    ["req_01Valid-id", "req_01Valid-id"],
    [long(124), long(124)],
    [undefined, undefined],
    ["", undefined],
    ["req_", undefined],
    ["Bearer fixture-private-token", undefined],
    ["req_valid\r\nAuthorization: fixture-private-token", undefined],
    [long(125), undefined],
    ["req_nonascii_é", undefined],
  ])("keeps only a bounded opaque id: %j", (requestId, expected) => {
    const failure = new NativeFailure("fixture error", FailureCode.server, {
      status: 529,
      requestId: requestId as string | undefined,
    })
    expect(failure.failure.requestId).toBe(expected)
    expect(failure.failure.status).toBe(529)
    expect(failure.message).toBe(
      expected === undefined ? "fixture error" : `fixture error (request_id=${expected})`,
    )
  })
})
