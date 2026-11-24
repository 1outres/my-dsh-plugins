import { useState } from "react"
import { InlineNameInput } from "./InlineNameInput"
import { PlusIcon } from "./icons"
import type { Translate } from "./types"

export interface AddColumnProps {
  readonly t: Translate
  readonly onAdd: (title: string) => void
}

export function AddColumn({ t, onAdd }: AddColumnProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tb-add-column">
      {open ? (
        <InlineNameInput
          initial=""
          label={t("columnName")}
          className="tb-name-input tb-add-column-input"
          blurAction="cancel"
          onSave={(name) => {
            setOpen(false)
            onAdd(name)
          }}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <button type="button" className="tb-ghost-row" onClick={() => setOpen(true)}>
          <PlusIcon />
          <span>{t("addColumn")}</span>
        </button>
      )}
    </div>
  )
}
