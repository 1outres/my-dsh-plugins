import { useEffect, useReducer, useRef } from "react"
import type { BoardSnapshot, CardNumber, ColumnId } from "../shared/model"
import { AddColumn } from "./AddColumn"
import type { BoardActions } from "./actions"
import { BoardColumn } from "./BoardColumn"
import { cardPlace, columnCards } from "./board"
import { DRAG_IDLE, dragReducer } from "./drag"
import { slotMoveIndex } from "./drop"
import { cardKeyMove, type KeyInput } from "./keys"
import type { Translate } from "./types"

export interface BoardViewProps {
  readonly snapshot: BoardSnapshot
  readonly actions: BoardActions
  readonly openNumber: CardNumber | undefined
  readonly t: Translate
  readonly onOpenCard: (number: CardNumber) => void
}

export function BoardView({ snapshot, actions, openNumber, t, onOpenCard }: BoardViewProps) {
  const [drag, dispatch] = useReducer(dragReducer, DRAG_IDLE)
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRef<CardNumber | undefined>(undefined)
  const columns = snapshot.board.columns

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new snapshot places the moved card
  useEffect(() => {
    const number = refocus.current
    if (number === undefined) return
    refocus.current = undefined
    root.current?.querySelector<HTMLElement>(`[data-card-number="${String(number)}"]`)?.focus()
  }, [snapshot])

  const keyMove = (number: CardNumber, input: KeyInput): void => {
    const place = cardPlace(snapshot.board, number)
    if (place === undefined) return
    const move = cardKeyMove(input, place)
    if (move === undefined) return
    const column = columns[move.column]
    if (column === undefined) return
    refocus.current = number
    void actions.moveCard(number, column.id, move.index)
  }

  const drop = (columnId: ColumnId, moving: CardNumber, slot: number): void => {
    const column = columns.find((candidate) => candidate.id === columnId)
    if (column === undefined) return
    const index = slotMoveIndex(column.cardNumbers, moving, slot)
    if (index === undefined) return
    void actions.moveCard(moving, columnId, index)
  }

  return (
    <div className="tb-board" ref={root}>
      {columns.map((column, index) => (
        <BoardColumn
          key={column.id}
          column={column}
          cards={columnCards(snapshot, column)}
          index={index}
          columnCount={columns.length}
          t={t}
          openNumber={openNumber}
          drag={drag}
          dispatch={dispatch}
          actions={actions}
          onOpenCard={onOpenCard}
          onKeyMove={keyMove}
          onDrop={drop}
        />
      ))}
      <AddColumn
        t={t}
        onAdd={(title) => {
          void actions.addColumn(title)
        }}
      />
    </div>
  )
}
