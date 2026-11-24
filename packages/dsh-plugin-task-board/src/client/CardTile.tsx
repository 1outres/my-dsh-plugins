import type { Card } from "../shared/model"
import { firstLine } from "./format"
import type { Translate } from "./types"

export interface CardTileProps {
  readonly card: Card
  readonly t: Translate
  readonly onOpen: (card: Card) => void
}

export function CardTile({ card, t, onOpen }: CardTileProps) {
  const detail = firstLine(card.description)
  return (
    <button
      type="button"
      className="tb-card"
      draggable
      aria-label={t("cardOpen", { number: card.number, title: card.title })}
      onClick={() => {
        onOpen(card)
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", String(card.number))
        event.dataTransfer.effectAllowed = "move"
      }}
    >
      <span className="tb-card-number">#{card.number}</span>
      <span className="tb-card-title">{card.title}</span>
      {detail === "" ? null : <span className="tb-card-detail">{detail}</span>}
      <span className="tb-card-meta">
        <span className="tb-card-comments" title={t("comments", { count: card.comments.length })}>
          {t("comments", { count: card.comments.length })}
        </span>
        {card.sessionIds.length === 0 ? null : (
          <span className="tb-card-linked" title={t("linked")}>
            {t("linked")} · {card.sessionIds.length}
          </span>
        )}
      </span>
    </button>
  )
}
