import { describe, expect, it } from "vitest"
import {
  cardKeyMove,
  composerKey,
  isCardMoveKey,
  isCommentPost,
  type KeyInput,
  nameKey,
} from "../src/client/keys"

function key(name: string, extra: Partial<KeyInput> = {}): KeyInput {
  return {
    key: name,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...extra,
  }
}

const MIDDLE = { column: 1, card: 1, columnCount: 3, cardCount: 3 }

describe("card keyboard moves", () => {
  it("moves a card to the neighbour column, appended", () => {
    expect(cardKeyMove(key("ArrowLeft", { altKey: true }), MIDDLE)).toEqual({
      column: 0,
      index: undefined,
    })
    expect(cardKeyMove(key("ArrowRight", { altKey: true }), MIDDLE)).toEqual({
      column: 2,
      index: undefined,
    })
  })

  it("moves a card inside its column", () => {
    expect(cardKeyMove(key("ArrowUp", { altKey: true }), MIDDLE)).toEqual({ column: 1, index: 0 })
    expect(cardKeyMove(key("ArrowDown", { altKey: true }), MIDDLE)).toEqual({ column: 1, index: 2 })
  })

  it("makes no move past an edge", () => {
    const corner = { column: 0, card: 0, columnCount: 1, cardCount: 1 }
    expect(cardKeyMove(key("ArrowLeft", { altKey: true }), corner)).toBeUndefined()
    expect(cardKeyMove(key("ArrowRight", { altKey: true }), corner)).toBeUndefined()
    expect(cardKeyMove(key("ArrowUp", { altKey: true }), corner)).toBeUndefined()
    expect(cardKeyMove(key("ArrowDown", { altKey: true }), corner)).toBeUndefined()
  })

  it("needs Alt alone", () => {
    expect(cardKeyMove(key("ArrowLeft"), MIDDLE)).toBeUndefined()
    expect(cardKeyMove(key("ArrowLeft", { altKey: true, shiftKey: true }), MIDDLE)).toBeUndefined()
    expect(cardKeyMove(key("ArrowLeft", { altKey: true, ctrlKey: true }), MIDDLE)).toBeUndefined()
    expect(cardKeyMove(key("ArrowLeft", { altKey: true, metaKey: true }), MIDDLE)).toBeUndefined()
    expect(cardKeyMove(key("Enter", { altKey: true }), MIDDLE)).toBeUndefined()
  })
})

describe("card move keys", () => {
  it("claims every Alt+Arrow, also at an edge, so the browser does not navigate", () => {
    for (const name of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(isCardMoveKey(key(name, { altKey: true }))).toBe(true)
    }
  })

  it("leaves other keys alone", () => {
    expect(isCardMoveKey(key("ArrowLeft"))).toBe(false)
    expect(isCardMoveKey(key("ArrowLeft", { altKey: true, shiftKey: true }))).toBe(false)
    expect(isCardMoveKey(key("Enter", { altKey: true }))).toBe(false)
  })
})

describe("text keys", () => {
  it("submits a composer on Enter and keeps Shift+Enter as a new line", () => {
    expect(composerKey(key("Enter"))).toBe("submit")
    expect(composerKey(key("Enter", { shiftKey: true }))).toBeUndefined()
    expect(composerKey(key("Enter", { isComposing: true }))).toBeUndefined()
    expect(composerKey(key("Escape"))).toBe("close")
    expect(composerKey(key("a"))).toBeUndefined()
  })

  it("saves a name on Enter and cancels on Escape", () => {
    expect(nameKey(key("Enter"))).toBe("save")
    expect(nameKey(key("Enter", { isComposing: true }))).toBeUndefined()
    expect(nameKey(key("Escape"))).toBe("cancel")
    expect(nameKey(key("x"))).toBeUndefined()
  })

  it("posts a comment on Ctrl+Enter or Cmd+Enter", () => {
    expect(isCommentPost(key("Enter", { ctrlKey: true }))).toBe(true)
    expect(isCommentPost(key("Enter", { metaKey: true }))).toBe(true)
    expect(isCommentPost(key("Enter"))).toBe(false)
    expect(isCommentPost(key("Enter", { ctrlKey: true, isComposing: true }))).toBe(false)
  })
})
