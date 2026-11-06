/**
 * Enter adds a line in the composer. On-screen keyboards have no Shift+Enter,
 * so the Harness default (Enter sends) leaves no way to write a second line.
 */

export interface EnterEvent {
  readonly key: string
  readonly isComposing?: boolean
  readonly keyCode?: number
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}

export interface ClosestLike {
  closest(selector: string): ClosestLike | null
  querySelector(selector: string): unknown
  /** False while the composer is inert (the blank Session's workspace trigger). */
  readonly isContentEditable?: boolean
}

/** The composer's editable surface (`@deepseek-ai/dsh-client-ui-conversation`). */
export const COMPOSER_INPUT = "[data-composer-input]"
/** An open command or reference menu inside the composer card, where Enter picks a row. */
export const OPEN_MENU = "[data-composer-overlay] [role='listbox']"

/**
 * Whether a keydown is a plain Enter in the composer that should add a line.
 * Enter that confirms an IME composition, Enter with a modifier, and Enter
 * while a composer menu is open keep their Harness meaning.
 */
export function shouldInsertNewline(event: EnterEvent, target: ClosestLike | null): boolean {
  if (event.key !== "Enter") return false
  if (event.isComposing === true || event.keyCode === 229) return false
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
  const input = target?.closest(COMPOSER_INPUT) ?? null
  if (input === null || input.isContentEditable === false) return false
  const card = input.closest("[data-composer-card]")
  if (card !== null && card.querySelector(OPEN_MENU) !== null) return false
  return true
}

interface KeyTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
    capture: boolean,
  ): void
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
    capture: boolean,
  ): void
}

function asClosest(target: EventTarget | null): ClosestLike | null {
  const candidate = target as Partial<ClosestLike> | null
  return candidate !== null && typeof candidate.closest === "function"
    ? (candidate as ClosestLike)
    : null
}

/**
 * Hide a plain Enter from the composer's own handlers, which would send. The
 * key's default action still runs, so the browser inserts the paragraph break
 * and the editor turns it into a line break in the draft.
 * @returns a disposer removing the capture listener.
 */
export function installEnterNewline(target: KeyTarget, active: () => boolean): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!active()) return
    if (!shouldInsertNewline(event, asClosest(event.target))) return
    event.stopImmediatePropagation()
  }
  target.addEventListener("keydown", listener, true)
  return () => target.removeEventListener("keydown", listener, true)
}
