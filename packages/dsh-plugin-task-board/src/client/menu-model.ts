export interface MenuItem {
  readonly kind: "item"
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly selected?: boolean
}

export interface MenuSeparator {
  readonly kind: "separator"
  readonly id: string
}

export type MenuEntry = MenuItem | MenuSeparator

function enabled(entry: MenuEntry | undefined): boolean {
  return entry?.kind === "item" && entry.disabled !== true
}

export function firstEnabledIndex(entries: readonly MenuEntry[]): number | undefined {
  const index = entries.findIndex(enabled)
  return index === -1 ? undefined : index
}

export function nextEnabledIndex(
  entries: readonly MenuEntry[],
  from: number,
  step: 1 | -1,
): number | undefined {
  const count = entries.length
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count
    if (enabled(entries[index])) return index
  }
  return undefined
}
