import { describe, expect, it } from "vitest"
import { buildTaskOptions, cardLabel, cardNumberFromOption } from "../src/client/task-options"
import type { BoardSnapshot } from "../src/shared/model"
import { BOARD, CARD_ONE, SNAPSHOT, translate } from "./client-support"

describe("task options", () => {
  it("labels a card with its number and title", () => {
    expect(cardLabel(CARD_ONE)).toBe("#1 Write the bridge")
  })

  it("lists one option per card, grouped by column in board order", () => {
    const options = buildTaskOptions(SNAPSHOT, translate)
    expect(options.map((option) => option.id)).toEqual(["1", "2", "3"])
    expect(options.map((option) => option.label)).toEqual([
      "#1 Write the bridge",
      "#2 Draw the board",
      "#3 Ship it",
    ])
    expect(options.map((option) => option.group?.name)).toEqual(["todo", "todo", "done"])
    expect(options.map((option) => option.group?.label)).toEqual(["To do", "To do", "Shipped"])
    expect(options[0]?.detail).toBe("First line")
    expect(options[1]?.detail).toBeUndefined()
  })

  it("fails loudly when the board names a missing card", () => {
    const broken: BoardSnapshot = {
      board: {
        ...BOARD,
        columns: [{ id: "todo", title: { kind: "preset", preset: "todo" }, cardNumbers: [9] }],
      },
      cards: [],
    }
    expect(() => buildTaskOptions(broken, translate)).toThrow("Card #9 is missing from the board")
  })

  it("reads a card number from an option id", () => {
    expect(cardNumberFromOption("12")).toBe(12)
    expect(() => cardNumberFromOption("0")).toThrow("The card number is not valid: 0")
    expect(() => cardNumberFromOption("x")).toThrow("The card number is not valid: x")
  })
})
