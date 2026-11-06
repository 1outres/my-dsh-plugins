/**
 * Keep the on-screen keyboard closed until the user taps the composer. The
 * composer focuses itself whenever a Session opens and when a toolbar button
 * in it is pressed; on a phone each of those pops the keyboard over the
 * conversation.
 */

import { COMPOSER_INPUT } from "./enter"

/** How recent a tap or key press must be to count as the reason for a focus. */
export const INTENT_WINDOW_MS = 1500

/** A tap here means the user wants to type. */
const COMPOSER_CARD = "[data-composer-card]"
/** Controls in the composer card that move focus without meaning "type now". */
const CONTROL =
  "button, a, input, select, textarea, [role='button'], [role='menuitem'], [role='option']"
/** The command button opens the slash menu, which is typing. */
const COMMAND_BUTTON = "[aria-haspopup='listbox']"

export interface ClosestTarget {
  closest(selector: string): unknown
}

function asTarget(target: unknown): ClosestTarget | null {
  const candidate = target as Partial<ClosestTarget> | null
  return candidate !== null && typeof candidate?.closest === "function"
    ? (candidate as ClosestTarget)
    : null
}

/** Whether a tap on this target asks for the keyboard. */
export function tapWantsKeyboard(target: unknown): boolean {
  const element = asTarget(target)
  if (element === null) return false
  if (element.closest(COMPOSER_INPUT) !== null) return true
  if (element.closest(COMPOSER_CARD) === null) return false
  return element.closest(CONTROL) === null || element.closest(COMMAND_BUTTON) !== null
}

export interface IntentState {
  /** Time of the last tap, or -Infinity. */
  tapAt: number
  /** Whether that tap asked for the keyboard. */
  tapWantsKeyboard: boolean
  /** Time of the last key press, or -Infinity. */
  keyAt: number
}

export function initialIntent(): IntentState {
  return {
    tapAt: Number.NEGATIVE_INFINITY,
    tapWantsKeyboard: false,
    keyAt: Number.NEGATIVE_INFINITY,
  }
}

/**
 * Whether a focus landing on `target` came without the user asking to type:
 * not after a tap on the composer, and not after a key press (a hardware
 * keyboard user moving focus on purpose).
 */
export function shouldBlockFocus(target: unknown, intent: IntentState, now: number): boolean {
  const element = asTarget(target)
  if (element === null || element.closest(COMPOSER_INPUT) === null) return false
  if (intent.tapWantsKeyboard && now - intent.tapAt <= INTENT_WINDOW_MS) return false
  if (intent.keyAt > intent.tapAt && now - intent.keyAt <= INTENT_WINDOW_MS) return false
  return true
}

interface FocusEventLike {
  readonly target: EventTarget | null
}

interface GuardTarget {
  addEventListener(type: string, listener: (event: FocusEventLike) => void, capture: boolean): void
  removeEventListener(
    type: string,
    listener: (event: FocusEventLike) => void,
    capture: boolean,
  ): void
}

/**
 * Blur the composer when it takes focus on its own while `active()`.
 * @returns a disposer removing the listeners.
 */
export function installFocusGuard(
  target: GuardTarget,
  active: () => boolean,
  now: () => number = Date.now,
): () => void {
  const intent = initialIntent()
  const onPointer = (event: FocusEventLike) => {
    intent.tapAt = now()
    intent.tapWantsKeyboard = tapWantsKeyboard(event.target)
  }
  const onKey = () => {
    intent.keyAt = now()
  }
  const onFocus = (event: FocusEventLike) => {
    if (!active() || !shouldBlockFocus(event.target, intent, now())) return
    const element = event.target as { blur?: () => void } | null
    element?.blur?.()
  }
  target.addEventListener("pointerdown", onPointer, true)
  target.addEventListener("keydown", onKey, true)
  target.addEventListener("focusin", onFocus, true)
  return () => {
    target.removeEventListener("pointerdown", onPointer, true)
    target.removeEventListener("keydown", onKey, true)
    target.removeEventListener("focusin", onFocus, true)
  }
}
