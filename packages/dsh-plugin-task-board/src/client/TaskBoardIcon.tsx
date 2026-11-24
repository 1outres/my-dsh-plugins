export interface TaskBoardIconProps {
  readonly size?: number
  readonly active?: boolean
}

export function TaskBoardIcon({ size = 16 }: TaskBoardIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
      <path d="M5.5 2.5v11M10.5 2.5v11" stroke="currentColor" />
      <path
        d="M3 5h1.2M6.8 5h1.2M12 5h1M3 7.5h1.2M6.8 7.5h1.2M12 7.5h1"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  )
}
