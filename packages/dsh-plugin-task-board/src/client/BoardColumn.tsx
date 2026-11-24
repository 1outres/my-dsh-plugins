import { type DragEvent, useRef } from "react"
import type { Card, CardNumber, Column, ColumnId } from "../shared/model"
import type { BoardActions } from "./actions"
import { columnTitle, parseCardNumber } from "./board"
import { CardComposer } from "./CardComposer"
import { CardTile } from "./CardTile"
import { ColumnHead } from "./ColumnHead"
import { type DragAction, type DragState, visibleSlot } from "./drag"
import { landingSlot } from "./drop"
import type { KeyInput } from "./keys"
import type { Translate } from "./types"

export interface BoardColumnProps {
  readonly column: Column
  readonly cards: readonly Card[]
  readonly index: number
  readonly columnCount: number
  readonly t: Translate
  readonly openNumber: CardNumber | undefined
  readonly drag: DragState
  readonly dispatch: (action: DragAction) => void
  readonly actions: BoardActions
  readonly onOpenCard: (number: CardNumber) => void
  readonly onKeyMove: (number: CardNumber, input: KeyInput) => void
  readonly onDrop: (columnId: ColumnId, moving: CardNumber, slot: number) => void
}

function cardMiddles(list: HTMLElement | null): number[] {
  if (list === null) return []
  return Array.from(list.querySelectorAll<HTMLElement>("[data-card-number]")).map((node) => {
    const box = node.getBoundingClientRect()
    return box.top + box.height / 2
  })
}

function slotMark(slot: number | undefined, index: number, count: number): string | undefined {
  if (slot === index) return "before"
  if (slot === count && index === count - 1) return "after"
  return undefined
}

export function BoardColumn({
  column,
  cards,
  index,
  columnCount,
  t,
  openNumber,
  drag,
  dispatch,
  actions,
  onOpenCard,
  onKeyMove,
  onDrop,
}: BoardColumnProps) {
  const list = useRef<HTMLOListElement>(null)
  const title = columnTitle(column.title, t)
  const shown = visibleSlot(drag, column.id, column.cardNumbers)

  const slotAt = (event: DragEvent): number => landingSlot(event.clientY, cardMiddles(list.current))

  return (
    <section
      className="tb-column"
      aria-label={title}
      onDragOver={(event) => {
        if (drag.dragging === undefined) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        dispatch({ type: "over", target: { columnId: column.id, slot: slotAt(event) } })
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        dispatch({ type: "leave", columnId: column.id })
      }}
      onDrop={(event) => {
        event.preventDefault()
        const moving = parseCardNumber(event.dataTransfer.getData("text/plain"))
        const slot = slotAt(event)
        dispatch({ type: "end" })
        if (moving !== undefined) onDrop(column.id, moving, slot)
      }}
    >
      <ColumnHead
        title={title}
        count={cards.length}
        index={index}
        columnCount={columnCount}
        t={t}
        onRename={(name) => {
          void actions.renameColumn(column.id, name)
        }}
        onMove={(target) => {
          void actions.moveColumn(column.id, target)
        }}
        onDelete={() => {
          void actions.deleteColumn(column.id)
        }}
      />
      <ol
        ref={list}
        className="tb-cards"
        data-drop={shown === 0 && cards.length === 0 ? "empty" : undefined}
      >
        {cards.map((card, position) => (
          <li
            key={card.number}
            className="tb-slot"
            data-drop={slotMark(shown, position, cards.length)}
          >
            <CardTile
              card={card}
              t={t}
              open={card.number === openNumber}
              dragging={card.number === drag.dragging}
              onOpen={onOpenCard}
              onDragStart={(number) => dispatch({ type: "start", number })}
              onDragEnd={() => dispatch({ type: "end" })}
              onKeyMove={onKeyMove}
            />
          </li>
        ))}
      </ol>
      <CardComposer t={t} onCreate={(name) => actions.createCard(column.id, name)} />
    </section>
  )
}
