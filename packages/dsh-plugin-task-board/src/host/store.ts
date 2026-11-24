import { createHash } from "node:crypto"
import type { Board, Card, CardNumber, ProjectPath } from "../shared/model"
import type { BoardStore, BoardTable, CardTable } from "./contract"

export function boardKey(project: ProjectPath): string {
  return createHash("sha256").update(project).digest("hex")
}

export function cardKey(project: ProjectPath, number: CardNumber): string {
  return `${boardKey(project)}_${number}`
}

export function createBoardStore(boards: BoardTable, cards: CardTable): BoardStore {
  return {
    board: (project) => boards.get(boardKey(project)),
    cards: (project) =>
      [...cards.entries()]
        .map(([, card]) => card)
        .filter((card) => card.project === project)
        .sort((left, right) => left.number - right.number),
    card: (project, number) => cards.get(cardKey(project, number)),
    saveBoard: async (board: Board) => {
      await boards.put(boardKey(board.project), board)
    },
    saveCard: async (card: Card) => {
      await cards.put(cardKey(card.project, card.number), card)
    },
    deleteCard: async (project, number) => {
      await cards.delete(cardKey(project, number))
    },
  }
}
