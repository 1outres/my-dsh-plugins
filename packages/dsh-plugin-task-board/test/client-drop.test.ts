import { describe, expect, it } from "vitest"
import { isSamePlace, landingSlot, slotMoveIndex } from "../src/client/drop"

describe("landing slot", () => {
  const middles = [100, 200, 300]

  it("lands before the first card whose middle is below the pointer", () => {
    expect(landingSlot(20, middles)).toBe(0)
    expect(landingSlot(99, middles)).toBe(0)
    expect(landingSlot(100, middles)).toBe(1)
    expect(landingSlot(150, middles)).toBe(1)
    expect(landingSlot(250, middles)).toBe(2)
  })

  it("lands at the end below the last middle", () => {
    expect(landingSlot(300, middles)).toBe(3)
    expect(landingSlot(900, middles)).toBe(3)
  })

  it("lands at the start of an empty column", () => {
    expect(landingSlot(40, [])).toBe(0)
  })
})

describe("slot moves", () => {
  it("knows the slots around the moving card keep its place", () => {
    expect(isSamePlace([1, 2, 3], 2, 1)).toBe(true)
    expect(isSamePlace([1, 2, 3], 2, 2)).toBe(true)
    expect(isSamePlace([1, 2, 3], 2, 0)).toBe(false)
    expect(isSamePlace([1, 2, 3], 2, 3)).toBe(false)
    expect(isSamePlace([1, 3], 2, 1)).toBe(false)
  })

  it("turns a slot into the move index the Host expects", () => {
    expect(slotMoveIndex([1, 2, 3], 1, 3)).toBe(2)
    expect(slotMoveIndex([1, 2, 3], 1, 2)).toBe(1)
    expect(slotMoveIndex([1, 2, 3], 3, 0)).toBe(0)
    expect(slotMoveIndex([1, 3], 2, 1)).toBe(1)
    expect(slotMoveIndex([1, 3], 2, 2)).toBe(2)
    expect(slotMoveIndex([], 2, 0)).toBe(0)
  })

  it("makes no move for a slot that keeps the place", () => {
    expect(slotMoveIndex([1, 2, 3], 1, 0)).toBeUndefined()
    expect(slotMoveIndex([1, 2, 3], 1, 1)).toBeUndefined()
    expect(slotMoveIndex([1, 2, 3], 3, 3)).toBeUndefined()
  })
})
