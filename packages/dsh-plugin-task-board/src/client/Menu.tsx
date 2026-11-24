import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react"
import { classNames } from "./class-names"
import { useDismissOnOutside } from "./hooks"
import { MenuRow } from "./MenuRow"
import { firstEnabledIndex, type MenuEntry, nextEnabledIndex } from "./menu-model"

export interface MenuProps {
  readonly open: boolean
  readonly anchor: ReactNode
  readonly entries: readonly MenuEntry[]
  readonly onSelect: (id: string) => void
  readonly onClose: () => void
  readonly align?: "start" | "end"
  readonly className?: string
}

function startIndex(entries: readonly MenuEntry[]): number | undefined {
  const selected = entries.findIndex((entry) => entry.kind === "item" && entry.selected === true)
  return selected === -1 ? firstEnabledIndex(entries) : selected
}

export function Menu({
  open,
  anchor,
  entries,
  onSelect,
  onClose,
  align = "start",
  className,
}: MenuProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const wasOpen = useRef(open)
  const entryKey = entries.map((entry) => entry.id).join("\n")

  useDismissOnOutside(rootRef, open, onClose)

  const focusAnchor = (): void => {
    rootRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new set of entries takes the focus again
  useEffect(() => {
    if (!open) return
    const index = startIndex(entries)
    if (index !== undefined) items.current[index]?.focus()
  }, [open, entryKey])

  useEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement
      if (active === null || active === document.body) focusAnchor()
    }
    wasOpen.current = open
  })

  const focusedIndex = (): number =>
    items.current.findIndex((item) => item !== null && item === document.activeElement)

  const move = (index: number | undefined): void => {
    if (index !== undefined) items.current[index]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        move(nextEnabledIndex(entries, focusedIndex(), 1))
        return
      case "ArrowUp":
        event.preventDefault()
        move(nextEnabledIndex(entries, focusedIndex(), -1))
        return
      case "Home":
        event.preventDefault()
        move(nextEnabledIndex(entries, -1, 1))
        return
      case "End":
        event.preventDefault()
        move(nextEnabledIndex(entries, entries.length, -1))
        return
      case "Escape":
        event.preventDefault()
        event.stopPropagation()
        onClose()
        focusAnchor()
        return
      case "Tab":
        onClose()
        return
    }
  }

  return (
    <span className="tb-menu-root" ref={rootRef}>
      {anchor}
      {open ? (
        <div
          className={classNames("tb-menu", align === "end" && "tb-menu-end", className)}
          role="menu"
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {entries.map((entry, index) =>
            entry.kind === "separator" ? (
              <hr key={entry.id} className="tb-menu-separator" />
            ) : (
              <MenuRow
                key={entry.id}
                item={entry}
                register={(node) => {
                  items.current[index] = node
                }}
                onSelect={onSelect}
              />
            ),
          )}
        </div>
      ) : null}
    </span>
  )
}
