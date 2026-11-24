import type { Column, ColumnId, ProjectPath, ProjectSummary } from "../shared/model"
import { columnTitle } from "./board"
import type { MenuEntry } from "./menu-model"
import type { Translate } from "./types"

export interface ColumnMenuPlace {
  readonly index: number
  readonly columnCount: number
  readonly cardCount: number
}

export type ColumnMenuAction = "rename" | "moveLeft" | "moveRight" | "delete"

export type CardMenuAction = "delete" | "confirm" | "cancel"

export function columnMenuEntries(place: ColumnMenuPlace, t: Translate): readonly MenuEntry[] {
  return [
    { kind: "item", id: "rename", label: t("rename") },
    { kind: "item", id: "moveLeft", label: t("moveLeft"), disabled: place.index === 0 },
    {
      kind: "item",
      id: "moveRight",
      label: t("moveRight"),
      disabled: place.index === place.columnCount - 1,
    },
    { kind: "separator", id: "separator" },
    {
      kind: "item",
      id: "delete",
      label: t("delete"),
      danger: true,
      disabled: place.cardCount > 0 || place.columnCount <= 1,
    },
  ]
}

export function cardMenuEntries(confirming: boolean, t: Translate): readonly MenuEntry[] {
  if (!confirming) return [{ kind: "item", id: "delete", label: t("deleteCard"), danger: true }]
  return [
    { kind: "item", id: "confirm", label: t("delete"), danger: true },
    { kind: "item", id: "cancel", label: t("cancel") },
  ]
}

export function projectMenuEntries(
  projects: readonly ProjectSummary[],
  selected: ProjectPath | undefined,
): readonly MenuEntry[] {
  return projects.map((project) => ({
    kind: "item",
    id: project.path,
    label: project.title,
    detail: project.path,
    selected: project.path === selected,
  }))
}

export function columnPickerEntries(
  columns: readonly Column[],
  current: ColumnId | undefined,
  t: Translate,
): readonly MenuEntry[] {
  return columns.map((column) => ({
    kind: "item",
    id: column.id,
    label: columnTitle(column.title, t),
    selected: column.id === current,
  }))
}
