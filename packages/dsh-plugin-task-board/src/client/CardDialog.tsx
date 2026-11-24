import { type FormEvent, useEffect, useRef, useState } from "react"
import type {
  Card,
  CardNumber,
  Comment,
  CommentId,
  SessionId,
  UpdateCardInput,
} from "../shared/model"
import { authorText, failureText, shortSessionId } from "./format"
import type { TaskBoardResult, Translate } from "./types"

export interface CardDialogActions {
  save(number: CardNumber, input: UpdateCardInput): Promise<TaskBoardResult<Card>>
  addComment(number: CardNumber, body: string): Promise<TaskBoardResult<Comment>>
  deleteComment(number: CardNumber, commentId: CommentId): Promise<TaskBoardResult<null>>
  unlinkSession(number: CardNumber, sessionId: SessionId): Promise<TaskBoardResult<Card>>
  deleteCard(number: CardNumber): Promise<TaskBoardResult<null>>
}

export interface CardDialogProps {
  readonly card: Card
  readonly t: Translate
  readonly actions: CardDialogActions
  readonly onClose: () => void
  readonly onDeleted: () => void
}

function timeOf(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function CardDialog({ card, t, actions, onClose, onDeleted }: CardDialogProps) {
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description)
  const [comment, setComment] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const node = dialog.current
    if (node === null) return
    const focusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]",
        ),
      )
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== "Tab") return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    node.addEventListener("keydown", onKeyDown)
    return () => node.removeEventListener("keydown", onKeyDown)
  }, [])

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = title.trim()
    if (next === "" || pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.save(card.number, { title: next, description })
    setPending(false)
    setError(failureText(result, t, "saveCardFailed"))
  }

  const postComment = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const body = comment.trim()
    if (body === "" || pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.addComment(card.number, body)
    setPending(false)
    const failure = failureText(result, t, "addCommentFailed")
    setError(failure)
    if (failure === undefined) setComment("")
  }

  const removeComment = async (commentId: CommentId): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.deleteComment(card.number, commentId)
    setPending(false)
    setError(failureText(result, t, "deleteCommentFailed"))
  }

  const unlink = async (sessionId: SessionId): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.unlinkSession(card.number, sessionId)
    setPending(false)
    setError(failureText(result, t, "unlinkFailed"))
  }

  const removeCard = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(undefined)
    const result = await actions.deleteCard(card.number)
    setPending(false)
    const failure = failureText(result, t, "deleteCardFailed")
    setError(failure)
    if (failure === undefined) {
      onDeleted()
      onClose()
    }
  }

  return (
    <div className="tb-dialog-backdrop">
      <div
        className="tb-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("cardOpen", { number: card.number, title: card.title })}
        ref={dialog}
      >
        <header className="tb-dialog-head">
          <span className="tb-card-number">#{card.number}</span>
          <button
            type="button"
            className="tb-icon-button"
            aria-label={t("close")}
            title={t("close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form className="tb-dialog-form" onSubmit={save}>
          <label className="tb-field">
            <span>{t("cardTitle")}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="tb-field">
            <span>{t("cardDescription")}</span>
            <textarea
              value={description}
              rows={5}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="tb-form-actions">
            <button type="submit" disabled={title.trim() === "" || pending}>
              {t("save")}
            </button>
          </div>
        </form>
        {error === undefined ? null : (
          <p className="tb-error" role="alert">
            {error}
          </p>
        )}
        <section className="tb-section">
          <h3>{t("commentsTitle")}</h3>
          {card.comments.length === 0 ? (
            <p className="tb-muted">{t("noComments")}</p>
          ) : (
            <ul className="tb-comments">
              {card.comments.map((item) => (
                <li key={item.id} className="tb-comment">
                  <div className="tb-comment-head">
                    <span className="tb-comment-author">{authorText(item.author, t)}</span>
                    <span className="tb-muted">{timeOf(item.createdAt)}</span>
                    {item.author.kind === "user" ? (
                      <button
                        type="button"
                        className="tb-link-button"
                        disabled={pending}
                        onClick={() => {
                          void removeComment(item.id)
                        }}
                      >
                        {t("deleteComment")}
                      </button>
                    ) : null}
                  </div>
                  <p className="tb-comment-body">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form className="tb-comment-form" onSubmit={postComment}>
            <textarea
              value={comment}
              aria-label={t("commentPlaceholder")}
              placeholder={t("commentPlaceholder")}
              rows={2}
              onChange={(event) => setComment(event.target.value)}
            />
            <div className="tb-form-actions">
              <button type="submit" disabled={comment.trim() === "" || pending}>
                {t("postComment")}
              </button>
            </div>
          </form>
        </section>
        <section className="tb-section">
          <h3>{t("linkedSessions")}</h3>
          {card.sessionIds.length === 0 ? (
            <p className="tb-muted">{t("noLinkedSessions")}</p>
          ) : (
            <ul className="tb-links">
              {card.sessionIds.map((sessionId) => (
                <li key={sessionId} className="tb-link">
                  <code>{shortSessionId(sessionId)}</code>
                  <button
                    type="button"
                    className="tb-link-button"
                    disabled={pending}
                    title={t("unlinkSession", { id: shortSessionId(sessionId) })}
                    onClick={() => {
                      void unlink(sessionId)
                    }}
                  >
                    {t("unlink")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="tb-section tb-danger-zone">
          {confirmingDelete ? (
            <>
              <p>{t("deleteCardQuestion")}</p>
              <p className="tb-muted">{t("deleteCardHint")}</p>
              <div className="tb-form-actions">
                <button
                  type="button"
                  className="tb-danger"
                  disabled={pending}
                  onClick={() => {
                    void removeCard()
                  }}
                >
                  {t("confirm")}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)}>
                  {t("cancel")}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="tb-danger" onClick={() => setConfirmingDelete(true)}>
              {t("deleteCard")}
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
