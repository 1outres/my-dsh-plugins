import { classNames } from "./class-names"
import { CheckIcon } from "./icons"
import type { MenuItem } from "./menu-model"

export interface MenuRowProps {
  readonly item: MenuItem
  readonly register: (node: HTMLButtonElement | null) => void
  readonly onSelect: (id: string) => void
}

function RowContent({ item }: { readonly item: MenuItem }) {
  return (
    <>
      <span className="tb-menu-text">
        <span className="tb-menu-label">{item.label}</span>
        {item.detail === undefined ? null : <span className="tb-menu-detail">{item.detail}</span>}
      </span>
      {item.selected === true ? <CheckIcon size={14} className="tb-menu-check" /> : null}
    </>
  )
}

export function MenuRow({ item, register, onSelect }: MenuRowProps) {
  const className = classNames("tb-menu-item", item.danger === true && "tb-menu-danger")
  if (item.selected === undefined) {
    return (
      <button
        ref={register}
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={item.disabled}
        className={className}
        onClick={() => onSelect(item.id)}
      >
        <RowContent item={item} />
      </button>
    )
  }
  return (
    <button
      ref={register}
      type="button"
      role="menuitemradio"
      aria-checked={item.selected}
      tabIndex={-1}
      disabled={item.disabled}
      className={className}
      onClick={() => onSelect(item.id)}
    >
      <RowContent item={item} />
    </button>
  )
}
