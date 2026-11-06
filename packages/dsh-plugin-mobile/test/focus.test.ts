import { describe, expect, it, vi } from "vitest"
import {
  initialIntent,
  installFocusGuard,
  shouldBlockFocus,
  tapWantsKeyboard,
} from "../src/client/focus"

/** A fake element that matches the listed selectors (and so the ancestors they stand for). */
function el(...matches: string[]) {
  return {
    closest: (selector: string) => (matches.includes(selector) ? {} : null),
    blur: vi.fn(),
  }
}

const CARD = "[data-composer-card]"
const INPUT = "[data-composer-input]"
const CONTROL =
  "button, a, input, select, textarea, [role='button'], [role='menuitem'], [role='option']"
const COMMAND = "[aria-haspopup='listbox']"

describe("tap intent", () => {
  it("counts the input and blank card space as asking for the keyboard", () => {
    expect(tapWantsKeyboard(el(INPUT, CARD))).toBe(true)
    expect(tapWantsKeyboard(el(CARD))).toBe(true)
    expect(tapWantsKeyboard(el(CARD, CONTROL, COMMAND))).toBe(true)
  })

  it("does not count composer buttons or anything outside the composer", () => {
    expect(tapWantsKeyboard(el(CARD, CONTROL))).toBe(false)
    expect(tapWantsKeyboard(el("[role='treeitem']"))).toBe(false)
    expect(tapWantsKeyboard(null)).toBe(false)
  })
})

describe("blocking focus", () => {
  const input = el(INPUT)

  it("blocks a focus nobody asked for", () => {
    expect(shouldBlockFocus(input, initialIntent(), 10_000)).toBe(true)
    const tappedRow = { ...initialIntent(), tapAt: 9_900, tapWantsKeyboard: false }
    expect(shouldBlockFocus(input, tappedRow, 10_000)).toBe(true)
  })

  it("allows a focus right after a tap on the composer or a key press", () => {
    const tapped = { ...initialIntent(), tapAt: 9_900, tapWantsKeyboard: true }
    expect(shouldBlockFocus(input, tapped, 10_000)).toBe(false)
    expect(shouldBlockFocus(input, tapped, 12_000)).toBe(true)
    const keyed = { ...initialIntent(), keyAt: 9_950 }
    expect(shouldBlockFocus(input, keyed, 10_000)).toBe(false)
  })

  it("leaves every other element alone", () => {
    expect(shouldBlockFocus(el("textarea"), initialIntent(), 10_000)).toBe(false)
  })
})

describe("focus guard", () => {
  type Listener = (event: { target: unknown }) => void

  function setup(active: () => boolean) {
    const listeners = new Map<string, Listener>()
    const captures: boolean[] = []
    let clock = 10_000
    const target = {
      addEventListener: (type: string, listener: Listener, capture: boolean) => {
        listeners.set(type, listener)
        captures.push(capture)
      },
      removeEventListener: (type: string) => listeners.delete(type),
    }
    const dispose = installFocusGuard(target as never, active, () => clock)
    return {
      listeners,
      captures,
      dispose,
      fire: (type: string, eventTarget: unknown) => listeners.get(type)?.({ target: eventTarget }),
      advance: (ms: number) => {
        clock += ms
      },
    }
  }

  it("blurs the composer when a Session switch focuses it", () => {
    const h = setup(() => true)
    expect(h.captures.every(Boolean)).toBe(true)
    const input = el(INPUT)
    h.fire("pointerdown", el("[role='treeitem']"))
    h.advance(120)
    h.fire("focusin", input)
    expect(input.blur).toHaveBeenCalledTimes(1)
  })

  it("keeps the focus a tap on the composer asked for", () => {
    const h = setup(() => true)
    const input = el(INPUT, CARD)
    h.fire("pointerdown", input)
    h.advance(80)
    h.fire("focusin", input)
    expect(input.blur).not.toHaveBeenCalled()
  })

  it("does nothing while inactive, and removes its listeners", () => {
    const h = setup(() => false)
    const input = el(INPUT)
    h.fire("focusin", input)
    expect(input.blur).not.toHaveBeenCalled()
    h.dispose()
    expect(h.listeners.size).toBe(0)
  })
})
