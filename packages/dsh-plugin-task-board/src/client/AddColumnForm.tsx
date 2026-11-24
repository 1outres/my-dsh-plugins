import { type FormEvent, useState } from "react"
import type { Translate } from "./types"

export interface AddColumnFormProps {
  readonly t: Translate
  readonly onAdd: (title: string) => Promise<void>
}

export function AddColumnForm({ t, onAdd }: AddColumnFormProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [pending, setPending] = useState(false)
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = title.trim()
    if (next === "" || pending) return
    setPending(true)
    await onAdd(next)
    setPending(false)
    setTitle("")
    setOpen(false)
  }
  if (!open) {
    return (
      <button type="button" className="tb-add-column" onClick={() => setOpen(true)}>
        + {t("addColumn")}
      </button>
    )
  }
  return (
    <form className="tb-add-column-form" onSubmit={submit}>
      <input
        value={title}
        aria-label={t("columnTitle")}
        placeholder={t("columnTitle")}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="tb-form-actions">
        <button type="submit" disabled={title.trim() === "" || pending}>
          {t("createCard")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setTitle("")
          }}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  )
}
