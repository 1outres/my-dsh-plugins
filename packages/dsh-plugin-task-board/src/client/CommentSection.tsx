import { useRef, useState } from "react"
import type { Card, CommentId } from "../shared/model"
import type { CardActions } from "./actions"
import { CommentItem } from "./CommentItem"
import { keyInput } from "./events"
import { FieldError } from "./FieldError"
import { failureText } from "./format"
import { useAutoGrow } from "./hooks"
import { isCommentPost } from "./keys"
import type { Translate } from "./types"
import { commentView } from "./view"

export interface CommentSectionProps {
  readonly card: Card
  readonly t: Translate
  readonly locale: string
  readonly now: number
  readonly actions: CardActions
}

export function CommentSection({ card, t, locale, now, actions }: CommentSectionProps) {
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const input = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(input)
  const count = card.comments.length

  const post = async (): Promise<void> => {
    const body = draft.trim()
    if (body === "" || pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.addComment(card.number, body)
    setPending(false)
    const failure = failureText(result, t, "postFailed")
    setError(failure)
    if (failure === undefined) setDraft("")
  }

  const remove = async (commentId: CommentId): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.deleteComment(card.number, commentId)
    setPending(false)
    setError(failureText(result, t, "deleteCommentFailed"))
  }

  return (
    <section className="tb-group">
      <h3 className="tb-group-head">
        <span>{t("comments")}</span>
        {count === 0 ? null : <span className="tb-count">{count}</span>}
      </h3>
      {count === 0 ? null : (
        <ul className="tb-comments">
          {card.comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={commentView(comment, now, locale, t)}
              createdAt={comment.createdAt}
              t={t}
              busy={pending}
              onDelete={() => {
                void remove(comment.id)
              }}
            />
          ))}
        </ul>
      )}
      <textarea
        ref={input}
        className="tb-comment-input"
        value={draft}
        placeholder={t("commentPlaceholder")}
        aria-label={t("commentPlaceholder")}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (!isCommentPost(keyInput(event))) return
          event.preventDefault()
          void post()
        }}
      />
      {draft.trim() === "" ? null : (
        <div className="tb-composer-row">
          <button
            type="button"
            className="tb-primary"
            disabled={pending}
            onClick={() => {
              void post()
            }}
          >
            {t("post")}
          </button>
        </div>
      )}
      <FieldError message={error} />
    </section>
  )
}
