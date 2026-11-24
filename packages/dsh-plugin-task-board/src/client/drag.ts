import type { CardNumber, ColumnId } from "../shared/model"
import { isSamePlace } from "./drop"

export interface DropTarget {
  readonly columnId: ColumnId
  readonly slot: number
}

export interface DragState {
  readonly dragging: CardNumber | undefined
  readonly target: DropTarget | undefined
}

export type DragAction =
  | { readonly type: "start"; readonly number: CardNumber }
  | { readonly type: "over"; readonly target: DropTarget }
  | { readonly type: "leave"; readonly columnId: ColumnId }
  | { readonly type: "end" }

export const DRAG_IDLE: DragState = { dragging: undefined, target: undefined }

export function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case "start":
      return { dragging: action.number, target: undefined }
    case "over": {
      const current = state.target
      if (
        current !== undefined &&
        current.columnId === action.target.columnId &&
        current.slot === action.target.slot
      ) {
        return state
      }
      return { ...state, target: action.target }
    }
    case "leave":
      if (state.target?.columnId !== action.columnId) return state
      return { ...state, target: undefined }
    case "end":
      return DRAG_IDLE
  }
}

export function visibleSlot(
  state: DragState,
  columnId: ColumnId,
  cardNumbers: readonly CardNumber[],
): number | undefined {
  const { dragging, target } = state
  if (dragging === undefined || target === undefined || target.columnId !== columnId) {
    return undefined
  }
  if (isSamePlace(cardNumbers, dragging, target.slot)) return undefined
  return target.slot
}
