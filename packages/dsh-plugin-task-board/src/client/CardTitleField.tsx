import { useState } from "react"
import type { Card } from "../shared/model"
import type { CardActions } from "./actions"
import { titleCommit } from "./drafts"
import { keyInput } from "./events"
import { FieldError } from "./FieldError"
import { failureText } from "./format"
import { nameKey } from "./keys"
import type { Translate } from "./types"
import { useDraft } from "./use-draft"

export interface CardTitleFieldProps {
  readonly card: Card
  readonly t: Translate
  readonly actions: CardActions
}

export function CardTitleField({ card, t, actions }: CardTitleFieldProps) {
  const [draft, setDraft] = useDraft(card.title)
  const [error, setError] = useState<string | undefined>(undefined)

  const commit = async (): Promise<void> => {
    const decision = titleCommit(draft, card.title)
    if (decision.kind === "keep") return
    if (decision.kind === "revert") {
      setDraft(card.title)
      return
    }
    setDraft(decision.title)
    setError(undefined)
    const result = await actions.save(card.number, { title: decision.title })
    setError(failureText(result, t, "saveFailed"))
  }

  return (
    <div className="tb-field">
      <input
        className="tb-title-input"
        value={draft}
        aria-label={t("cardTitle")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          void commit()
        }}
        onKeyDown={(event) => {
          if (nameKey(keyInput(event)) !== "save") return
          event.preventDefault()
          event.currentTarget.blur()
        }}
      />
      <FieldError message={error} />
    </div>
  )
}
