interface IconProps {
  size?: number
  className?: string
}

/** Three bars: drawn for this plugin on the shipped 16px, 1px-stroke grid. */
export function IconMenu({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}
