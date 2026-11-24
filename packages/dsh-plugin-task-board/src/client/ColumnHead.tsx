import { useState } from "react"
import { classNames } from "./class-names"
import { IconButton } from "./IconButton"
import { InlineNameInput } from "./InlineNameInput"
import { MoreIcon } from "./icons"
import { Menu } from "./Menu"
import { columnMenuEntries } from "./menus"
import type { Translate } from "./types"

export interface ColumnHeadProps {
  readonly title: string
  readonly count: number
  readonly index: number
  readonly columnCount: number
  readonly t: Translate
  readonly onRename: (title: string) => void
  readonly onMove: (index: number) => void
  readonly onDelete: () => void
}

export function ColumnHead({
  title,
  count,
  index,
  columnCount,
  t,
  onRename,
  onMove,
  onDelete,
}: ColumnHeadProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const select = (id: string): void => {
    setMenuOpen(false)
    if (id === "rename") setRenaming(true)
    if (id === "moveLeft") onMove(index - 1)
    if (id === "moveRight") onMove(index + 1)
    if (id === "delete") onDelete()
  }

  return (
    <header className={classNames("tb-column-head", menuOpen && "tb-column-head-active")}>
      {renaming ? (
        <InlineNameInput
          initial={title}
          label={t("columnName")}
          className="tb-name-input tb-column-rename"
          blurAction="save"
          onSave={(name) => {
            setRenaming(false)
            onRename(name)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <h2 className="tb-column-title" onDoubleClick={() => setRenaming(true)}>
            {title}
          </h2>
          {count === 0 ? null : <span className="tb-count">{count}</span>}
        </>
      )}
      <Menu
        open={menuOpen}
        align="end"
        entries={columnMenuEntries({ index, columnCount, cardCount: count }, t)}
        onSelect={select}
        onClose={() => setMenuOpen(false)}
        anchor={
          <IconButton
            className="tb-quiet tb-column-more"
            label={t("columnMenu")}
            expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon />
          </IconButton>
        }
      />
    </header>
  )
}
