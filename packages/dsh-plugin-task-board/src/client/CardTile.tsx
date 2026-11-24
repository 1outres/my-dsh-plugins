import type { Card, CardNumber } from "../shared/model"
import { classNames } from "./class-names"
import { keyInput } from "./events"
import { CommentIcon, LinkIcon } from "./icons"
import { isCardMoveKey, type KeyInput } from "./keys"
import type { Translate } from "./types"
import { cardFace } from "./view"

export interface CardTileProps {
  readonly card: Card
  readonly t: Translate
  readonly open: boolean
  readonly dragging: boolean
  readonly onOpen: (number: CardNumber) => void
  readonly onDragStart: (number: CardNumber) => void
  readonly onDragEnd: () => void
  readonly onKeyMove: (number: CardNumber, input: KeyInput) => void
}

export function CardTile({
  card,
  t,
  open,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onKeyMove,
}: CardTileProps) {
  const face = cardFace(card)
  return (
    <button
      type="button"
      className={classNames("tb-card", open && "tb-card-open", dragging && "tb-card-dragging")}
      data-card-number={card.number}
      draggable
      aria-label={t("cardOpen", { number: card.number, title: card.title })}
      aria-expanded={open}
      onClick={() => onOpen(card.number)}
      onKeyDown={(event) => {
        const input = keyInput(event)
        if (!isCardMoveKey(input)) return
        event.preventDefault()
        onKeyMove(card.number, input)
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", String(card.number))
        event.dataTransfer.effectAllowed = "move"
        onDragStart(card.number)
      }}
      onDragEnd={onDragEnd}
    >
      <span className="tb-card-title">{face.title}</span>
      {face.detail === undefined ? null : <span className="tb-card-detail">{face.detail}</span>}
      <span className="tb-card-footer">
        <span>{face.number}</span>
        {face.comments === undefined ? null : (
          <span className="tb-card-meta tb-card-comments" title={t("comments")}>
            <CommentIcon size={12} />
            {face.comments}
          </span>
        )}
        {face.linked ? (
          <span className="tb-card-meta tb-card-linked" title={t("sessions")}>
            <LinkIcon size={12} />
          </span>
        ) : null}
      </span>
    </button>
  )
}
