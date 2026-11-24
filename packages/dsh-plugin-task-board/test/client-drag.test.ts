import { describe, expect, it } from "vitest"
import { DRAG_IDLE, dragReducer, visibleSlot } from "../src/client/drag"

describe("drag state", () => {
  it("starts a drag without a target", () => {
    expect(dragReducer(DRAG_IDLE, { type: "start", number: 2 })).toEqual({
      dragging: 2,
      target: undefined,
    })
  })

  it("follows the pointer and keeps the same state for the same target", () => {
    const started = dragReducer(DRAG_IDLE, { type: "start", number: 2 })
    const over = dragReducer(started, { type: "over", target: { columnId: "todo", slot: 1 } })
    expect(over.target).toEqual({ columnId: "todo", slot: 1 })
    expect(dragReducer(over, { type: "over", target: { columnId: "todo", slot: 1 } })).toBe(over)
    expect(
      dragReducer(over, { type: "over", target: { columnId: "done", slot: 0 } }).target,
    ).toEqual({ columnId: "done", slot: 0 })
  })

  it("drops the target when the pointer leaves its column only", () => {
    const started = dragReducer(DRAG_IDLE, { type: "start", number: 2 })
    const over = dragReducer(started, { type: "over", target: { columnId: "todo", slot: 1 } })
    expect(dragReducer(over, { type: "leave", columnId: "done" })).toBe(over)
    expect(dragReducer(over, { type: "leave", columnId: "todo" })).toEqual({
      dragging: 2,
      target: undefined,
    })
  })

  it("ends a drag", () => {
    const started = dragReducer(DRAG_IDLE, { type: "start", number: 2 })
    expect(dragReducer(started, { type: "end" })).toBe(DRAG_IDLE)
  })

  it("shows the landing slot of the hovered column unless the card keeps its place", () => {
    const state = { dragging: 2, target: { columnId: "todo", slot: 0 } }
    expect(visibleSlot(state, "todo", [1, 2])).toBe(0)
    expect(visibleSlot(state, "done", [3])).toBeUndefined()
    expect(
      visibleSlot({ dragging: 2, target: { columnId: "todo", slot: 1 } }, "todo", [1, 2]),
    ).toBeUndefined()
    expect(
      visibleSlot({ dragging: 2, target: { columnId: "todo", slot: 2 } }, "todo", [1, 2]),
    ).toBeUndefined()
    expect(
      visibleSlot({ dragging: 9, target: { columnId: "todo", slot: 2 } }, "todo", [1, 2]),
    ).toBe(2)
    expect(visibleSlot(DRAG_IDLE, "todo", [1, 2])).toBeUndefined()
  })
})
