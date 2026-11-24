import { useState } from "react"
import type { Card, Column } from "../shared/model"
import type { CardActions } from "./actions"
import { columnTitle } from "./board"
import { failureText } from "./format"
import { IconButton } from "./IconButton"
import { ChevronDownIcon, CloseIcon, MoreIcon } from "./icons"
import { Menu } from "./Menu"
import { cardMenuEntries, columnPickerEntries } from "./menus"
import type { Translate } from "./types"

export interface CardPanelBarProps {
  readonly card: Card
  readonly columns: readonly Column[]
  readonly t: Translate
  readonly actions: CardActions
  readonly onClose: () => void
  readonly onError: (message: string | undefined) => void
}

export function CardPanelBar({ card, columns, t, actions, onClose, onError }: CardPanelBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const column = columns.find((candidate) => candidate.cardNumbers.includes(card.number))

  const closeMore = (): void => {
    setMoreOpen(false)
    setConfirming(false)
  }

  const moveTo = async (columnId: string): Promise<void> => {
    setPickerOpen(false)
    if (columnId === column?.id) return
    onError(undefined)
    onError(failureText(await actions.moveTo(card.number, columnId), t, "moveCardFailed"))
  }

  const remove = async (): Promise<void> => {
    closeMore()
    onError(undefined)
    const failure = failureText(await actions.deleteCard(card.number), t, "deleteCardFailed")
    if (failure === undefined) onClose()
    else onError(failure)
  }

  const selectMore = (id: string): void => {
    if (id === "delete") setConfirming(true)
    if (id === "cancel") closeMore()
    if (id === "confirm") void remove()
  }

  return (
    <div className="tb-panel-bar">
      <span className="tb-panel-number">#{card.number}</span>
      <Menu
        open={pickerOpen}
        entries={columnPickerEntries(columns, column?.id, t)}
        onSelect={(id) => {
          void moveTo(id)
        }}
        onClose={() => setPickerOpen(false)}
        anchor={
          <button
            type="button"
            className="tb-capsule"
            title={t("moveToColumn")}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <span>{column === undefined ? null : columnTitle(column.title, t)}</span>
            <ChevronDownIcon size={14} />
          </button>
        }
      />
      <div className="tb-panel-actions">
        <Menu
          open={moreOpen}
          align="end"
          entries={cardMenuEntries(confirming, t)}
          onSelect={selectMore}
          onClose={closeMore}
          anchor={
            <IconButton
              className="tb-bar-button"
              label={t("more")}
              expanded={moreOpen}
              onClick={() => (moreOpen ? closeMore() : setMoreOpen(true))}
            >
              <MoreIcon />
            </IconButton>
          }
        />
        <IconButton className="tb-bar-button" label={t("close")} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  )
}
