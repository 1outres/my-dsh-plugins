import type { KeyboardEvent } from "react"
import type { KeyInput } from "./keys"

export function keyInput(event: KeyboardEvent<Element>): KeyInput {
  return {
    key: event.key,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    isComposing: event.nativeEvent.isComposing,
  }
}
