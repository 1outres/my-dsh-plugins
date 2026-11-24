import { BoardIcon } from "./icons"

export interface EmptyStateProps {
  readonly title: string
}

export function EmptyState({ title }: EmptyStateProps) {
  return (
    <div className="tb-empty">
      <BoardIcon size={24} className="tb-empty-glyph" />
      <p className="tb-empty-title">{title}</p>
    </div>
  )
}
