interface IconProps {
  size?: number
  className?: string
}

/** A page with a plus: drawn for this plugin on the shipped 16px, 1px-stroke grid. */
export function IconScratch({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.5l-4-4Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path d="M9.5 1.5v4h4" stroke="currentColor" strokeLinejoin="round" />
      <path d="M8 7.5v5M5.5 10h5" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}
