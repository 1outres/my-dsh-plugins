import { describe, expect, it } from "vitest"
import { nextFocusIndex } from "../src/client/focus"

describe("nextFocusIndex", () => {
  it("moves to the next control with Tab", () => {
    expect(nextFocusIndex(0, 2, false)).toBe(1)
  })

  it("moves to the previous control with Shift+Tab", () => {
    expect(nextFocusIndex(1, 2, true)).toBe(0)
  })

  it("leaves the group after the last control", () => {
    expect(nextFocusIndex(1, 2, false)).toBeNull()
  })

  it("leaves the group before the first control", () => {
    expect(nextFocusIndex(0, 2, true)).toBeNull()
  })

  it("leaves the group when focus is not on one of its controls", () => {
    expect(nextFocusIndex(-1, 2, false)).toBeNull()
    expect(nextFocusIndex(-1, 2, true)).toBeNull()
  })
})
