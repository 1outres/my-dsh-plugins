import { useState } from "react"
import type { Card, SessionId } from "../shared/model"
import type { CardActions } from "./actions"
import { FieldError } from "./FieldError"
import { failureText, shortSessionId } from "./format"
import { IconButton } from "./IconButton"
import { CloseIcon } from "./icons"
import type { Translate } from "./types"

export interface LinkedSessionsProps {
  readonly card: Card
  readonly t: Translate
  readonly actions: CardActions
}

export function LinkedSessions({ card, t, actions }: LinkedSessionsProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const unlink = async (sessionId: SessionId): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.unlinkSession(card.number, sessionId)
    setPending(false)
    setError(failureText(result, t, "unlinkFailed"))
  }

  return (
    <section className="tb-group">
      <h3 className="tb-group-head">
        <span>{t("sessions")}</span>
      </h3>
      <ul className="tb-chips">
        {card.sessionIds.map((sessionId) => (
          <li key={sessionId} className="tb-chip">
            <code>{shortSessionId(sessionId)}</code>
            <IconButton
              className="tb-quiet tb-chip-remove"
              label={t("unlinkSession", { id: shortSessionId(sessionId) })}
              disabled={pending}
              onClick={() => {
                void unlink(sessionId)
              }}
            >
              <CloseIcon size={12} />
            </IconButton>
          </li>
        ))}
      </ul>
      <FieldError message={error} />
    </section>
  )
}
