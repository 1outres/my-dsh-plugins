import { describe, expect, it, vi } from "vitest"
import { type ClosestLike, installEnterNewline, shouldInsertNewline } from "../src/client/enter"

interface Node {
  matches: string[]
  parent?: Node
  menu?: boolean
  editable?: boolean
}

function element(node: Node): ClosestLike {
  return {
    closest(selector) {
      let current: Node | undefined = node
      while (current !== undefined) {
        if (current.matches.includes(selector)) return element(current)
        current = current.parent
      }
      return null
    },
    querySelector() {
      return node.menu === true ? {} : null
    },
    isContentEditable: node.editable,
  }
}

const card: Node = { matches: ["[data-composer-card]"] }
const input = element({ matches: ["[data-composer-input]"], parent: card })
const plain = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }

describe("Enter in the composer", () => {
  it("adds a line for a plain Enter in the composer", () => {
    expect(shouldInsertNewline(plain, input)).toBe(true)
  })

  it("keeps modifiers, IME confirmation and other keys as they are", () => {
    expect(shouldInsertNewline({ ...plain, shiftKey: true }, input)).toBe(false)
    expect(shouldInsertNewline({ ...plain, metaKey: true }, input)).toBe(false)
    expect(shouldInsertNewline({ ...plain, isComposing: true }, input)).toBe(false)
    expect(shouldInsertNewline({ ...plain, keyCode: 229 }, input)).toBe(false)
    expect(shouldInsertNewline({ ...plain, key: "a" }, input)).toBe(false)
  })

  it("leaves Enter alone outside the composer and while a menu is open", () => {
    expect(shouldInsertNewline(plain, element({ matches: [] }))).toBe(false)
    expect(shouldInsertNewline(plain, null)).toBe(false)
    const open: Node = { matches: ["[data-composer-card]"], menu: true }
    expect(
      shouldInsertNewline(plain, element({ matches: ["[data-composer-input]"], parent: open })),
    ).toBe(false)
  })

  it("leaves the inert composer of a blank Session alone", () => {
    const inert = element({ matches: ["[data-composer-input]"], parent: card, editable: false })
    expect(shouldInsertNewline(plain, inert)).toBe(false)
  })

  it("stops the event before the composer sees it, only while active", () => {
    let listener: ((event: KeyboardEvent) => void) | undefined
    let captured: boolean | undefined
    const target = {
      addEventListener: (
        _type: "keydown",
        next: (event: KeyboardEvent) => void,
        capture: boolean,
      ) => {
        listener = next
        captured = capture
      },
      removeEventListener: () => {
        listener = undefined
      },
    }
    let active = true
    const dispose = installEnterNewline(target, () => active)
    expect(captured).toBe(true)

    const event = { ...plain, target: input, stopImmediatePropagation: vi.fn() }
    listener?.(event as unknown as KeyboardEvent)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)

    active = false
    listener?.(event as unknown as KeyboardEvent)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)

    dispose()
    expect(listener).toBeUndefined()
  })
})
