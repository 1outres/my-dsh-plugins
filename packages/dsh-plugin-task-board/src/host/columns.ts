import type { Board, CardNumber, Column, ColumnId } from "../shared/model"
import { COLUMN_PRESET_TITLES } from "../shared/model"

export function columnTitleText(column: Column): string {
  return column.title.kind === "preset"
    ? COLUMN_PRESET_TITLES[column.title.preset]
    : column.title.text
}

export function columnOf(board: Board, columnId: ColumnId): Column | undefined {
  return board.columns.find((column) => column.id === columnId)
}

export function columnWithCard(board: Board, number: CardNumber): Column | undefined {
  return board.columns.find((column) => column.cardNumbers.includes(number))
}

export function findColumn(board: Board, reference: string): Column | undefined {
  const wanted = reference.trim()
  const byId = columnOf(board, wanted)
  if (byId !== undefined) return byId
  const wantedTitle = wanted.toLowerCase()
  return board.columns.find((column) => columnTitleText(column).toLowerCase() === wantedTitle)
}
