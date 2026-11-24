import type { Card } from "../shared/model"
import { commentText } from "./comments"

export function buildCardMessage(card: Card, columnTitle: string): string {
  const sections = [
    `Task card #${card.number} from the task board of this project.`,
    [`Title: ${card.title}`, `Column: ${columnTitle}`].join("\n"),
  ]
  if (card.description.length > 0) {
    sections.push(`Description:\n${card.description}`)
  }
  if (card.comments.length > 0) {
    sections.push(["Comments:", ...card.comments.map(commentText)].join("\n"))
  }
  sections.push(
    `Work on this card. Use the task_board tool with number ${card.number} to comment on it or to move it to another column.`,
  )
  return sections.join("\n\n")
}
