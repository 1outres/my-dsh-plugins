import { type DragEvent, type FormEvent, useState } from "react"
import type { Card, CardNumber, Column, ColumnId } from "../shared/model"
import { columnTitle, parseCardNumber } from "./board"
import { CardTile } from "./CardTile"
import type { Translate } from "./types"

export interface BoardColumnProps {
  readonly column: Column
  readonly cards: readonly Card[]
  readonly index: number
  readonly columnCount: number
  readonly t: Translate
  readonly onOpenCard: (card: Card) => void
  readonly onCreateCard: (columnId: ColumnId, title: string, description: string) => Promise<void>
  readonly onRenameColumn: (columnId: ColumnId, title: string) => Promise<void>
  readonly onMoveColumn: (columnId: ColumnId, index: number) => Promise<void>
  readonly onDeleteColumn: (columnId: ColumnId) => Promise<void>
  readonly onDropCard: (
    columnId: ColumnId,
    moving: CardNumber,
    before: CardNumber | undefined,
  ) => void
}

export function BoardColumn({
  column,
  cards,
  index,
  columnCount,
  t,
  onOpenCard,
  onCreateCard,
  onRenameColumn,
  onMoveColumn,
  onDeleteColumn,
  onDropCard,
}: BoardColumnProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [pending, setPending] = useState(false)
  const [dropActive, setDropActive] = useState(false)

  const titleText = columnTitle(column.title, t)
  const deleteBlocked = cards.length > 0 || columnCount === 1

  const startRename = (): void => {
    setRenameValue(titleText)
    setRenaming(true)
    setMenuOpen(false)
  }

  const submitRename = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = renameValue.trim()
    if (next === "" || pending) return
    setPending(true)
    await onRenameColumn(column.id, next)
    setPending(false)
    setRenaming(false)
  }

  const removeColumn = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    await onDeleteColumn(column.id)
    setPending(false)
    setConfirmingDelete(false)
  }

  const submitCard = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = title.trim()
    if (next === "" || pending) return
    setPending(true)
    await onCreateCard(column.id, next, description)
    setPending(false)
    setTitle("")
    setDescription("")
    setAddingCard(false)
  }

  const drop = (event: DragEvent, before: CardNumber | undefined): void => {
    event.preventDefault()
    event.stopPropagation()
    setDropActive(false)
    const moving = parseCardNumber(event.dataTransfer.getData("text/plain"))
    if (moving === undefined) return
    onDropCard(column.id, moving, before)
  }

  return (
    <section
      aria-label={titleText}
      className={dropActive ? "tb-column tb-column-drop" : "tb-column"}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setDropActive(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropActive(false)
      }}
      onDrop={(event) => drop(event, undefined)}
    >
      <header className="tb-column-head">
        {renaming ? (
          <form className="tb-rename" onSubmit={submitRename}>
            <input
              value={renameValue}
              aria-label={t("columnTitle")}
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <button type="submit" disabled={renameValue.trim() === "" || pending}>
              {t("save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false)
              }}
            >
              {t("cancel")}
            </button>
          </form>
        ) : (
          <h2 className="tb-column-title">{titleText}</h2>
        )}
        <span className="tb-column-count">{t("cards", { count: cards.length })}</span>
        <div className="tb-menu-wrap">
          <button
            type="button"
            className="tb-icon-button"
            aria-label={t("columnMenu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="tb-menu" role="menu">
              <button type="button" role="menuitem" onClick={startRename}>
                {t("renameColumn")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={index === 0 || pending}
                onClick={() => {
                  setMenuOpen(false)
                  void onMoveColumn(column.id, index - 1)
                }}
              >
                {t("moveColumnLeft")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={index === columnCount - 1 || pending}
                onClick={() => {
                  setMenuOpen(false)
                  void onMoveColumn(column.id, index + 1)
                }}
              >
                {t("moveColumnRight")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-danger"
                disabled={deleteBlocked || pending}
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmingDelete(true)
                }}
              >
                {t("deleteColumn")}
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {confirmingDelete ? (
        <div className="tb-confirm">
          <p>{t("deleteColumnQuestion")}</p>
          {cards.length > 0 ? (
            <p className="tb-muted">{t("deleteColumnHint")}</p>
          ) : columnCount === 1 ? (
            <p className="tb-muted">{t("lastColumnHint")}</p>
          ) : null}
          <div className="tb-form-actions">
            <button type="button" className="tb-danger" disabled={pending} onClick={removeColumn}>
              {t("confirm")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false)
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <ol className="tb-column-cards">
        {cards.map((card) => (
          <li
            key={card.number}
            className="tb-drop-zone"
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onDrop={(event) => drop(event, card.number)}
          >
            <CardTile card={card} t={t} onOpen={onOpenCard} />
          </li>
        ))}
        {cards.length === 0 ? <li className="tb-column-empty">{t("noCards")}</li> : null}
      </ol>
      {addingCard ? (
        <form className="tb-add-card" onSubmit={submitCard}>
          <input
            value={title}
            aria-label={t("cardTitle")}
            placeholder={t("cardTitle")}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            value={description}
            aria-label={t("cardDescription")}
            placeholder={t("descriptionOptional")}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="tb-form-actions">
            <button type="submit" disabled={title.trim() === "" || pending}>
              {t("createCard")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingCard(false)
                setTitle("")
                setDescription("")
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="tb-add-card-button" onClick={() => setAddingCard(true)}>
          + {t("addCard")}
        </button>
      )}
    </section>
  )
}
