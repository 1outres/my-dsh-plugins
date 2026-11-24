import { useEffect, useRef, useState } from "react"
import type { Card, Column } from "../shared/model"
import type { CardActions } from "./actions"
import { CardDescriptionField } from "./CardDescriptionField"
import { CardPanelBar } from "./CardPanelBar"
import { CardTitleField } from "./CardTitleField"
import { CommentSection } from "./CommentSection"
import { FieldError } from "./FieldError"
import { LinkedSessions } from "./LinkedSessions"
import type { Translate } from "./types"

export interface CardPanelProps {
  readonly card: Card
  readonly columns: readonly Column[]
  readonly t: Translate
  readonly locale: string
  readonly now: number
  readonly actions: CardActions
  readonly onClose: () => void
}

export function CardPanel({ card, columns, t, locale, now, actions, onClose }: CardPanelProps) {
  const panel = useRef<HTMLElement>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  return (
    <aside
      ref={panel}
      className="tb-panel"
      role="dialog"
      aria-modal="false"
      aria-label={card.title}
      tabIndex={-1}
    >
      <CardPanelBar
        card={card}
        columns={columns}
        t={t}
        actions={actions}
        onClose={onClose}
        onError={setError}
      />
      <div className="tb-panel-scroll">
        <FieldError message={error} />
        <div className="tb-panel-fields">
          <CardTitleField card={card} t={t} actions={actions} />
          <CardDescriptionField card={card} t={t} actions={actions} />
        </div>
        <CommentSection card={card} t={t} locale={locale} now={now} actions={actions} />
        {card.sessionIds.length === 0 ? null : (
          <LinkedSessions card={card} t={t} actions={actions} />
        )}
      </div>
    </aside>
  )
}
