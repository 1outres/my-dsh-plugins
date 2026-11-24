import { describe, expect, it } from "vitest"
import { firstEnabledIndex, type MenuEntry, nextEnabledIndex } from "../src/client/menu-model"
import {
  cardMenuEntries,
  columnMenuEntries,
  columnPickerEntries,
  projectMenuEntries,
} from "../src/client/menus"
import { BOARD, OTHER_PROJECT, PROJECT, translate } from "./client-support"

describe("menu navigation", () => {
  const entries: readonly MenuEntry[] = [
    { kind: "item", id: "a", label: "A", disabled: true },
    { kind: "item", id: "b", label: "B" },
    { kind: "separator", id: "s" },
    { kind: "item", id: "c", label: "C" },
    { kind: "item", id: "d", label: "D", disabled: true },
  ]

  it("finds the first enabled item", () => {
    expect(firstEnabledIndex(entries)).toBe(1)
    expect(firstEnabledIndex([{ kind: "separator", id: "s" }])).toBeUndefined()
  })

  it("walks enabled items and wraps around", () => {
    expect(nextEnabledIndex(entries, 1, 1)).toBe(3)
    expect(nextEnabledIndex(entries, 3, 1)).toBe(1)
    expect(nextEnabledIndex(entries, 1, -1)).toBe(3)
    expect(nextEnabledIndex(entries, -1, 1)).toBe(1)
    expect(nextEnabledIndex([], -1, 1)).toBeUndefined()
  })
})

describe("menus", () => {
  it("lists the column actions and blocks the ones that cannot run", () => {
    expect(columnMenuEntries({ index: 0, columnCount: 3, cardCount: 0 }, translate)).toEqual([
      { kind: "item", id: "rename", label: "Rename" },
      { kind: "item", id: "moveLeft", label: "Move left", disabled: true },
      { kind: "item", id: "moveRight", label: "Move right", disabled: false },
      { kind: "separator", id: "separator" },
      { kind: "item", id: "delete", label: "Delete", danger: true, disabled: false },
    ])
    const last = columnMenuEntries({ index: 2, columnCount: 3, cardCount: 1 }, translate)
    expect(last.find((entry) => entry.id === "moveRight")).toMatchObject({ disabled: true })
    expect(last.find((entry) => entry.id === "delete")).toMatchObject({ disabled: true })
    const only = columnMenuEntries({ index: 0, columnCount: 1, cardCount: 0 }, translate)
    expect(only.find((entry) => entry.id === "delete")).toMatchObject({ disabled: true })
  })

  it("asks for the card deletion inside the same menu", () => {
    expect(cardMenuEntries(false, translate)).toEqual([
      { kind: "item", id: "delete", label: "Delete card", danger: true },
    ])
    expect(cardMenuEntries(true, translate)).toEqual([
      { kind: "item", id: "confirm", label: "Delete", danger: true },
      { kind: "item", id: "cancel", label: "Cancel" },
    ])
  })

  it("lists the projects with their path and marks the current one", () => {
    expect(projectMenuEntries([PROJECT, OTHER_PROJECT], PROJECT.path)).toEqual([
      { kind: "item", id: PROJECT.path, label: "repo", detail: "/work/repo", selected: true },
      {
        kind: "item",
        id: OTHER_PROJECT.path,
        label: "other",
        detail: "/work/other",
        selected: false,
      },
    ])
  })

  it("lists the columns a card can move to", () => {
    expect(columnPickerEntries(BOARD.columns, "todo", translate)).toEqual([
      { kind: "item", id: "todo", label: "To do", selected: true },
      { kind: "item", id: "in_progress", label: "In progress", selected: false },
      { kind: "item", id: "done", label: "Shipped", selected: false },
    ])
  })
})
