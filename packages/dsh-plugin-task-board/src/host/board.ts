import type { Board, CardNumber, Column, ColumnId, ProjectPath } from "../shared/model"
import { DEFAULT_COLUMN_PRESETS } from "../shared/model"

export function createDefaultBoard(project: ProjectPath, now: number): Board {
  return {
    project,
    columns: DEFAULT_COLUMN_PRESETS.map(
      (preset): Column => ({ id: preset, title: { kind: "preset", preset }, cardNumbers: [] }),
    ),
    nextCardNumber: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function boardWithColumn(board: Board, column: Column, now: number): Board {
  const known = board.columns.some((candidate) => candidate.id === column.id)
  return {
    ...board,
    columns: known
      ? board.columns.map((candidate) => (candidate.id === column.id ? column : candidate))
      : [...board.columns, column],
    updatedAt: now,
  }
}

export function boardWithoutColumn(board: Board, columnId: ColumnId, now: number): Board {
  return {
    ...board,
    columns: board.columns.filter((column) => column.id !== columnId),
    updatedAt: now,
  }
}

export function boardWithoutCard(board: Board, number: CardNumber, now: number): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.cardNumbers.includes(number)
        ? { ...column, cardNumbers: column.cardNumbers.filter((candidate) => candidate !== number) }
        : column,
    ),
    updatedAt: now,
  }
}

export function boardWithCardAt(
  board: Board,
  number: CardNumber,
  columnId: ColumnId,
  index: number | undefined,
  now: number,
): Board {
  const withoutCard = board.columns.map((column) =>
    column.cardNumbers.includes(number)
      ? { ...column, cardNumbers: column.cardNumbers.filter((candidate) => candidate !== number) }
      : column,
  )
  return {
    ...board,
    columns: withoutCard.map((column) => {
      if (column.id !== columnId) return column
      const at = index ?? column.cardNumbers.length
      return {
        ...column,
        cardNumbers: [...column.cardNumbers.slice(0, at), number, ...column.cardNumbers.slice(at)],
      }
    }),
    updatedAt: now,
  }
}

export function boardWithNextCardNumber(board: Board, number: CardNumber, now: number): Board {
  return { ...board, nextCardNumber: number, updatedAt: now }
}
