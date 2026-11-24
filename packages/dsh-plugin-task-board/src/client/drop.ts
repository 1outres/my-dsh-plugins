import type { CardNumber } from "../shared/model"
import { dropIndex } from "./board"

export function landingSlot(pointerY: number, middles: readonly number[]): number {
  const index = middles.findIndex((middle) => pointerY < middle)
  return index === -1 ? middles.length : index
}

export function isSamePlace(
  cardNumbers: readonly CardNumber[],
  moving: CardNumber,
  slot: number,
): boolean {
  const current = cardNumbers.indexOf(moving)
  return current !== -1 && (slot === current || slot === current + 1)
}

export function slotMoveIndex(
  cardNumbers: readonly CardNumber[],
  moving: CardNumber,
  slot: number,
): number | undefined {
  if (isSamePlace(cardNumbers, moving, slot)) return undefined
  return dropIndex(cardNumbers, moving, cardNumbers[slot])
}
