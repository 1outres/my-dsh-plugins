import type { Card, Comment, CommentId, SessionId, UpdateCardInput } from "../shared/model"

export function cardWithFields(card: Card, fields: UpdateCardInput, now: number): Card {
  return {
    ...card,
    ...(fields.title === undefined ? {} : { title: fields.title }),
    ...(fields.description === undefined ? {} : { description: fields.description }),
    updatedAt: now,
  }
}

export function cardWithComment(card: Card, comment: Comment, now: number): Card {
  return { ...card, comments: [...card.comments, comment], updatedAt: now }
}

export function cardWithoutComment(card: Card, commentId: CommentId, now: number): Card {
  return {
    ...card,
    comments: card.comments.filter((comment) => comment.id !== commentId),
    updatedAt: now,
  }
}

export function cardWithSession(card: Card, sessionId: SessionId, now: number): Card {
  if (card.sessionIds.includes(sessionId)) return card
  return { ...card, sessionIds: [...card.sessionIds, sessionId], updatedAt: now }
}

export function cardWithoutSession(card: Card, sessionId: SessionId, now: number): Card {
  if (!card.sessionIds.includes(sessionId)) return card
  return {
    ...card,
    sessionIds: card.sessionIds.filter((candidate) => candidate !== sessionId),
    updatedAt: now,
  }
}
