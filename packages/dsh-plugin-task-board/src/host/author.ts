import type { Author } from "../shared/model"

export function authorLabel(author: Author): string {
  return author.kind === "user" ? "user" : `agent ${author.sessionId}`
}
