import type { Board, BoardSnapshot, Card, CardNumber, Column, ColumnTitle } from "../shared/model"
import type { CardPlace } from "./keys"
import type { Translate } from "./types"

export function columnTitle(title: ColumnTitle, t: Translate): string {
  return title.kind === "text" ? title.text : t(`column.${title.preset}`)
}

export function cardByNumber(snapshot: BoardSnapshot, number: CardNumber): Card | undefined {
  return snapshot.cards.find((card) => card.number === number)
}

export function columnCards(snapshot: BoardSnapshot, column: Column): readonly Card[] {
  return column.cardNumbers.map((number) => {
    const card = cardByNumber(snapshot, number)
    if (card === undefined) throw new Error(`Card #${String(number)} is missing from the board`)
    return card
  })
}

export function dropIndex(
  cardNumbers: readonly CardNumber[],
  moving: CardNumber,
  before: CardNumber | undefined,
): number {
  const movingIndex = cardNumbers.indexOf(moving)
  const raw = before === undefined ? cardNumbers.length : cardNumbers.indexOf(before)
  const target = raw === -1 ? cardNumbers.length : raw
  if (movingIndex !== -1 && movingIndex < target) return target - 1
  return target
}

export function parseCardNumber(text: string): CardNumber | undefined {
  const trimmed = text.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined
  return Number(trimmed)
}
export function columnOfCard(board: Board, number: CardNumber): Column | undefined {
  return board.columns.find((column) => column.cardNumbers.includes(number))
}

export function cardPlace(board: Board, number: CardNumber): CardPlace | undefined {
  const column = board.columns.findIndex((candidate) => candidate.cardNumbers.includes(number))
  const owner = board.columns[column]
  if (owner === undefined) return undefined
  return {
    column,
    card: owner.cardNumbers.indexOf(number),
    columnCount: board.columns.length,
    cardCount: owner.cardNumbers.length,
  }
}
