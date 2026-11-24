import type { Comment } from "../shared/model"
import { authorLabel } from "./author"

export function commentText(comment: Comment): string {
  const [first = "", ...rest] = comment.body.split("\n")
  const head = `- ${authorLabel(comment.author)}, ${new Date(comment.createdAt).toISOString()}: ${first}`
  return [head, ...rest.map((line) => `  ${line}`)].join("\n")
}
