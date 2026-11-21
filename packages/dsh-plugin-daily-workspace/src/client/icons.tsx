interface IconProps {
  size?: number
  className?: string
}

/** A calendar with a plus: drawn for this plugin on the shipped 16px, 1px-stroke grid. */
export function IconToday({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path d="M2.5 6.5h11" stroke="currentColor" />
      <path d="M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeLinecap="round" />
      <path d="M8 8.5v4M6 10.5h4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}
