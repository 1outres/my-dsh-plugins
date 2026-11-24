import { useEffect, useRef, useState } from "react"
import { keyInput } from "./events"
import { useAutoGrow, useDismissOnOutside } from "./hooks"
import { IconButton } from "./IconButton"
import { CloseIcon, PlusIcon } from "./icons"
import { composerKey } from "./keys"
import type { Translate } from "./types"

export interface CardComposerProps {
  readonly t: Translate
  readonly onCreate: (title: string) => Promise<boolean>
}

export function CardComposer({ t, onCreate }: CardComposerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const close = (): void => {
    setOpen(false)
    setDraft("")
  }

  useDismissOnOutside(root, open, close)
  useAutoGrow(input)

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  const submit = async (): Promise<void> => {
    const title = draft.trim()
    if (title === "" || pending) return
    setPending(true)
    const created = await onCreate(title)
    setPending(false)
    if (!created) return
    setDraft("")
    input.current?.focus()
  }

  if (!open) {
    return (
      <button type="button" className="tb-ghost-row tb-add-card" onClick={() => setOpen(true)}>
        <PlusIcon />
        <span>{t("addCard")}</span>
      </button>
    )
  }

  return (
    <div className="tb-composer" ref={root}>
      <textarea
        ref={input}
        className="tb-composer-input"
        rows={1}
        value={draft}
        aria-label={t("cardTitle")}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          const action = composerKey(keyInput(event))
          if (action === undefined) return
          event.preventDefault()
          if (action === "close") {
            event.stopPropagation()
            close()
            return
          }
          void submit()
        }}
      />
      <div className="tb-composer-actions">
        <button
          type="button"
          className="tb-primary"
          disabled={draft.trim() === "" || pending}
          onClick={() => {
            void submit()
          }}
        >
          {t("add")}
        </button>
        <IconButton label={t("close")} onClick={close}>
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  )
}
