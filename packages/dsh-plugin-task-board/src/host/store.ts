import type { Board, Card, CardNumber, ProjectPath } from "../shared/model"
import type { BoardStore, BoardTable, CardTable } from "./contract"

export function cardKey(project: ProjectPath, number: CardNumber): string {
  return `${project}\u0000${number}`
}

function projectPrefix(project: ProjectPath): string {
  return `${project}\u0000`
}

export function createBoardStore(boards: BoardTable, cards: CardTable): BoardStore {
  return {
    board: (project) => boards.get(project),
    cards: (project) => {
      const prefix = projectPrefix(project)
      return [...cards.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, card]) => card)
        .sort((left, right) => left.number - right.number)
    },
    card: (project, number) => cards.get(cardKey(project, number)),
    saveBoard: async (board: Board) => {
      await boards.put(board.project, board)
    },
    saveCard: async (card: Card) => {
      await cards.put(cardKey(card.project, card.number), card)
    },
    deleteCard: async (project, number) => {
      await cards.delete(cardKey(project, number))
    },
  }
}
