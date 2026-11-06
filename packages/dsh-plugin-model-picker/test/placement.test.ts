import { describe, expect, it } from "vitest"
import { isCoarsePointer, placeMenu, viewBoxOf } from "../src/client/placement"

const desktop = { left: 0, top: 0, width: 1280, height: 800 }

describe("menu placement", () => {
  it("sits above the trigger, right-aligned", () => {
    const placed = placeMenu({ top: 700, right: 900 }, { width: 400, height: 300 }, desktop)
    expect(placed).toEqual({ left: 500, top: 392, maxHeight: 680 })
  })

  it("stays inside the left and right margins", () => {
    const placed = placeMenu({ top: 700, right: 200 }, { width: 400, height: 300 }, desktop)
    expect(placed.left).toBe(12)
  })

  it("caps a tall menu to the room above the trigger instead of covering it", () => {
    // A phone with the keyboard up: 390x420 visible, trigger 60px above its bottom.
    const view = { left: 0, top: 0, width: 390, height: 420 }
    const placed = placeMenu({ top: 360, right: 380 }, { width: 358, height: 560 }, view)
    expect(placed.maxHeight).toBe(340)
    expect(placed.top).toBe(12)
    expect(placed.top + Math.min(560, placed.maxHeight)).toBeLessThanOrEqual(360 - 8)
  })

  it("follows a visual viewport scrolled by the keyboard", () => {
    const view = { left: 0, top: 300, width: 390, height: 420 }
    const placed = placeMenu({ top: 660, right: 380 }, { width: 358, height: 200 }, view)
    expect(placed.top).toBe(452)
    expect(placed.maxHeight).toBe(340)
  })

  it("may overlap the trigger when there is almost no room above it", () => {
    const placed = placeMenu({ top: 80, right: 900 }, { width: 400, height: 300 }, desktop)
    expect(placed.maxHeight).toBe(776)
    expect(placed.top).toBe(12)
  })
})

describe("viewport facts", () => {
  it("prefers the visual viewport", () => {
    expect(
      viewBoxOf({
        innerWidth: 390,
        innerHeight: 760,
        visualViewport: { offsetLeft: 0, offsetTop: 120, width: 390, height: 400 },
      }),
    ).toEqual({ left: 0, top: 120, width: 390, height: 400 })
    expect(viewBoxOf({ innerWidth: 1280, innerHeight: 800 })).toEqual(desktop)
  })

  it("detects a coarse pointer and tolerates a missing matchMedia", () => {
    expect(
      isCoarsePointer({ innerWidth: 0, innerHeight: 0, matchMedia: () => ({ matches: true }) }),
    ).toBe(true)
    expect(
      isCoarsePointer({ innerWidth: 0, innerHeight: 0, matchMedia: () => ({ matches: false }) }),
    ).toBe(false)
    expect(isCoarsePointer({ innerWidth: 0, innerHeight: 0 })).toBe(false)
    expect(isCoarsePointer(undefined)).toBe(false)
  })
})
