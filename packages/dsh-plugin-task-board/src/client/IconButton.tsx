import type { ReactNode } from "react"
import { classNames } from "./class-names"

export interface IconButtonProps {
  readonly label: string
  readonly onClick: () => void
  readonly children: ReactNode
  readonly className?: string
  readonly expanded?: boolean
  readonly disabled?: boolean
}

export function IconButton({
  label,
  onClick,
  children,
  className,
  expanded,
  disabled,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={classNames("tb-icon-button", className)}
      aria-label={label}
      title={label}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
