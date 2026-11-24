import { useEffect, useRef, useState } from "react"
import { type NameCommit, nameCommit } from "./drafts"
import { keyInput } from "./events"
import { nameKey } from "./keys"

export interface InlineNameInputProps {
  readonly initial: string
  readonly label: string
  readonly className: string
  readonly blurAction: "save" | "cancel"
  readonly onSave: (name: string) => void
  readonly onCancel: () => void
}

export function InlineNameInput({
  initial,
  label,
  className,
  blurAction,
  onSave,
  onCancel,
}: InlineNameInputProps) {
  const [draft, setDraft] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const finish = (commit: NameCommit): void => {
    if (settled.current) return
    settled.current = true
    if (commit.kind === "save") onSave(commit.name)
    else onCancel()
  }

  return (
    <input
      ref={input}
      className={className}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(blurAction === "save" ? nameCommit(draft, initial) : { kind: "cancel" })}
      onKeyDown={(event) => {
        const action = nameKey(keyInput(event))
        if (action === undefined) return
        event.preventDefault()
        event.stopPropagation()
        finish(action === "save" ? nameCommit(draft, initial) : { kind: "cancel" })
      }}
    />
  )
}
