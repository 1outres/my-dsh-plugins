import { BoardIcon } from "./icons"

export interface TaskBoardIconProps {
  readonly size?: number
  readonly active?: boolean
}

export function TaskBoardIcon({ size = 16 }: TaskBoardIconProps) {
  return <BoardIcon size={size} />
}
