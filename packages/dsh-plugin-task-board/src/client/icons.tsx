import type { ReactNode } from "react"

export interface IconProps {
  readonly size?: number
  readonly className?: string
}

interface SvgProps extends IconProps {
  readonly children: ReactNode
}

function Svg({ size = 16, className, children }: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Svg>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Svg>
  )
}

export function CommentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.75 4.25c0-.83.67-1.5 1.5-1.5h7.5c.83 0 1.5.67 1.5 1.5v5.5c0 .83-.67 1.5-1.5 1.5H7.25L4.5 13.25v-2h-.25c-.83 0-1.5-.67-1.5-1.5z" />
    </Svg>
  )
}

export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.75 9.25l2.5-2.5" />
      <path d="M7.25 4.75l.9-.9a2.47 2.47 0 0 1 3.5 3.5l-.9.9" />
      <path d="M8.75 11.25l-.9.9a2.47 2.47 0 0 1-3.5-3.5l.9-.9" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4.5h10M6.5 4.5V3.25h3V4.5" />
      <path d="M4.5 4.5l.5 8.25c.05.7.6 1.25 1.3 1.25h3.4c.7 0 1.25-.55 1.3-1.25l.5-8.25" />
    </Svg>
  )
}

export function BoardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="2.75" width="3" height="9" rx="1" />
      <rect x="6.5" y="2.75" width="3" height="6" rx="1" />
      <rect x="10.75" y="2.75" width="3" height="10.5" rx="1" />
    </Svg>
  )
}
