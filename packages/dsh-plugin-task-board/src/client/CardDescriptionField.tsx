import { useRef, useState } from "react"
import type { Card } from "../shared/model"
import type { CardActions } from "./actions"
import { descriptionCommit } from "./drafts"
import { FieldError } from "./FieldError"
import { failureText } from "./format"
import { useAutoGrow } from "./hooks"
import type { Translate } from "./types"
import { useDraft } from "./use-draft"

export interface CardDescriptionFieldProps {
  readonly card: Card
  readonly t: Translate
  readonly actions: CardActions
}

export function CardDescriptionField({ card, t, actions }: CardDescriptionFieldProps) {
  const [draft, setDraft] = useDraft(card.description)
  const [error, setError] = useState<string | undefined>(undefined)
  const input = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(input)

  const commit = async (): Promise<void> => {
    const decision = descriptionCommit(draft, card.description)
    if (decision.kind === "keep") return
    setError(undefined)
    const result = await actions.save(card.number, { description: decision.description })
    setError(failureText(result, t, "saveFailed"))
  }

  return (
    <div className="tb-field">
      <textarea
        ref={input}
        className="tb-description"
        rows={1}
        value={draft}
        placeholder={t("description")}
        aria-label={t("description")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          void commit()
        }}
      />
      <FieldError message={error} />
    </div>
  )
}
