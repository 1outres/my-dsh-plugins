import type { BoardSnapshot, Card, CardNumber, SessionId } from "../shared/model"
import { columnTitleText, columnWithCard } from "./columns"
import { commentText } from "./comments"

function cardOfSnapshot(snapshot: BoardSnapshot, number: CardNumber): Card {
  const card = snapshot.cards.find((candidate) => candidate.number === number)
  if (card === undefined) {
    throw new Error(`Card #${number} is listed in a column but does not exist.`)
  }
  return card
}

function cardLine(card: Card, sessionId: SessionId): string {
  const mark = card.sessionIds.includes(sessionId) ? " (linked to this session)" : ""
  return `  #${card.number} ${card.title}${mark}`
}

function sessionLines(card: Card, sessionId: SessionId): readonly string[] {
  if (card.sessionIds.length === 0) return ["none"]
  return card.sessionIds.map((id) => `- ${id}${id === sessionId ? " (this session)" : ""}`)
}

export function renderBoard(snapshot: BoardSnapshot, sessionId: SessionId): string {
  const lines = [`Task board of ${snapshot.board.project}`]
  for (const column of snapshot.board.columns) {
    lines.push("", columnTitleText(column))
    for (const number of column.cardNumbers) {
      lines.push(cardLine(cardOfSnapshot(snapshot, number), sessionId))
    }
  }
  return lines.join("\n")
}

export function renderCard(card: Card, columnTitle: string, sessionId: SessionId): string {
  const lines = [`#${card.number} ${card.title}`, `Column: ${columnTitle}`]
  if (card.description.length > 0) {
    lines.push("", "Description:", card.description)
  }
  if (card.comments.length > 0) {
    lines.push("", "Comments:", ...card.comments.map(commentText))
  }
  lines.push("", "Linked sessions:", ...sessionLines(card, sessionId))
  return lines.join("\n")
}

export function renderCards(
  snapshot: BoardSnapshot,
  cards: readonly Card[],
  sessionId: SessionId,
): string {
  return cards
    .map((card) => {
      const column = columnWithCard(snapshot.board, card.number)
      if (column === undefined) {
        throw new Error(`Card #${card.number} is not in any column of this board.`)
      }
      return renderCard(card, columnTitleText(column), sessionId)
    })
    .join("\n\n")
}
