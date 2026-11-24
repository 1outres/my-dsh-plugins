import type { Card, Comment, CommentId } from "../shared/model"
import { authorParts, firstLine, fullTime, relativeTime } from "./format"
import type { Translate } from "./types"

export interface CardFace {
  readonly number: string
  readonly title: string
  readonly detail: string | undefined
  readonly comments: number | undefined
  readonly linked: boolean
}

export interface CommentView {
  readonly id: CommentId
  readonly author: string
  readonly agentId: string | undefined
  readonly relative: string
  readonly full: string
  readonly body: string
  readonly deletable: boolean
}

export function cardFace(card: Card): CardFace {
  const detail = firstLine(card.description)
  return {
    number: `#${String(card.number)}`,
    title: card.title,
    detail: detail === "" ? undefined : detail,
    comments: card.comments.length === 0 ? undefined : card.comments.length,
    linked: card.sessionIds.length > 0,
  }
}

export function commentView(
  comment: Comment,
  now: number,
  locale: string,
  t: Translate,
): CommentView {
  const author = authorParts(comment.author, t)
  return {
    id: comment.id,
    author: author.name,
    agentId: author.id,
    relative: relativeTime(comment.createdAt, now, locale),
    full: fullTime(comment.createdAt, locale),
    body: comment.body,
    deletable: comment.author.kind === "user",
  }
}
