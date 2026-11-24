import { describe, expect, it } from "vitest"
import {
  cardByNumber,
  columnCards,
  columnTitle,
  dropIndex,
  parseCardNumber,
} from "../src/client/board"
import { ja } from "../src/client/i18n"
import type { BoardSnapshot } from "../src/shared/model"
import { BOARD, CARD_ONE, dictionaryTranslator, SNAPSHOT, translate } from "./client-support"

describe("board helpers", () => {
  it("localizes preset column titles and keeps custom titles", () => {
    expect(columnTitle({ kind: "preset", preset: "todo" }, translate)).toBe("To do")
    expect(columnTitle({ kind: "preset", preset: "in_progress" }, translate)).toBe("In progress")
    expect(columnTitle({ kind: "text", text: "Shipped" }, translate)).toBe("Shipped")
    const t = dictionaryTranslator(ja)
    expect(columnTitle({ kind: "preset", preset: "todo" }, t)).toBe("未着手")
    expect(columnTitle({ kind: "preset", preset: "in_progress" }, t)).toBe("作業中")
    expect(columnTitle({ kind: "preset", preset: "done" }, t)).toBe("完了")
  })

  it("finds a card by number", () => {
    expect(cardByNumber(SNAPSHOT, 1)).toBe(CARD_ONE)
    expect(cardByNumber(SNAPSHOT, 9)).toBeUndefined()
  })

  it("collects the cards of a column in board order", () => {
    const column = BOARD.columns[0]
    if (column === undefined) throw new Error("expected a column")
    expect(columnCards(SNAPSHOT, column).map((card) => card.number)).toEqual([1, 2])
  })

  it("fails loudly when a column names a missing card", () => {
    const broken: BoardSnapshot = {
      board: {
        ...BOARD,
        columns: [{ id: "todo", title: { kind: "preset", preset: "todo" }, cardNumbers: [9] }],
      },
      cards: [],
    }
    const column = broken.board.columns[0]
    if (column === undefined) throw new Error("expected a column")
    expect(() => columnCards(broken, column)).toThrow("Card #9 is missing from the board")
  })

  it("computes the drop index inside one column", () => {
    expect(dropIndex([1, 2, 3], 1, 3)).toBe(1)
    expect(dropIndex([1, 2, 3], 3, 1)).toBe(0)
    expect(dropIndex([1, 2, 3], 1, 2)).toBe(0)
    expect(dropIndex([1, 2, 3], 2, undefined)).toBe(2)
    expect(dropIndex([1, 2], 9, 2)).toBe(1)
    expect(dropIndex([1, 2], 9, undefined)).toBe(2)
  })

  it("appends when the drop marker is unknown", () => {
    expect(dropIndex([1, 2, 3], 2, 9)).toBe(2)
    expect(dropIndex([1, 2, 3], 9, 8)).toBe(3)
  })

  it("parses a dragged card number", () => {
    expect(parseCardNumber("3")).toBe(3)
    expect(parseCardNumber(" 2 ")).toBe(2)
    expect(parseCardNumber("")).toBeUndefined()
    expect(parseCardNumber("0")).toBeUndefined()
    expect(parseCardNumber("1.5")).toBeUndefined()
    expect(parseCardNumber("abc")).toBeUndefined()
  })
})
