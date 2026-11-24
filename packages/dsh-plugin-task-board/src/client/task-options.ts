import type { BoardSnapshot, Card, CardNumber } from "../shared/model"
import { columnTitle } from "./board"
import { firstLine } from "./format"
import type { SelectOption, Translate } from "./types"

export function cardLabel(card: Card): string {
  return `#${String(card.number)} ${card.title}`
}

export function buildTaskOptions(snapshot: BoardSnapshot, t: Translate): readonly SelectOption[] {
  const options: SelectOption[] = []
  for (const column of snapshot.board.columns) {
    const group = { name: column.id, label: columnTitle(column.title, t) }
    for (const number of column.cardNumbers) {
      const card = snapshot.cards.find((candidate) => candidate.number === number)
      if (card === undefined) {
        throw new Error(`Card #${String(number)} is missing from the board`)
      }
      const detail = firstLine(card.description)
      options.push({
        id: String(card.number),
        label: cardLabel(card),
        group,
        ...(detail === "" ? {} : { detail }),
      })
    }
  }
  return options
}

export function cardNumberFromOption(id: string): CardNumber {
  const number = Number(id)
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`The card number is not valid: ${id}`)
  }
  return number
}
