export interface KeyInput {
  readonly key: string
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly isComposing: boolean
}

export interface CardPlace {
  readonly column: number
  readonly card: number
  readonly columnCount: number
  readonly cardCount: number
}

export interface CardKeyMove {
  readonly column: number
  readonly index: number | undefined
}

export type ComposerKey = "submit" | "close"

export type NameKey = "save" | "cancel"

function onlyAlt(input: KeyInput): boolean {
  return input.altKey && !input.shiftKey && !input.ctrlKey && !input.metaKey
}

const MOVE_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])

export function isCardMoveKey(input: KeyInput): boolean {
  return onlyAlt(input) && MOVE_KEYS.has(input.key)
}

export function cardKeyMove(input: KeyInput, place: CardPlace): CardKeyMove | undefined {
  if (!isCardMoveKey(input)) return undefined
  switch (input.key) {
    case "ArrowLeft":
      return place.column > 0 ? { column: place.column - 1, index: undefined } : undefined
    case "ArrowRight":
      return place.column < place.columnCount - 1
        ? { column: place.column + 1, index: undefined }
        : undefined
    case "ArrowUp":
      return place.card > 0 ? { column: place.column, index: place.card - 1 } : undefined
    case "ArrowDown":
      return place.card < place.cardCount - 1
        ? { column: place.column, index: place.card + 1 }
        : undefined
    default:
      return undefined
  }
}

export function composerKey(input: KeyInput): ComposerKey | undefined {
  if (input.key === "Escape") return "close"
  if (input.key === "Enter" && !input.shiftKey && !input.isComposing) return "submit"
  return undefined
}

export function nameKey(input: KeyInput): NameKey | undefined {
  if (input.key === "Escape") return "cancel"
  if (input.key === "Enter" && !input.isComposing) return "save"
  return undefined
}

export function isCommentPost(input: KeyInput): boolean {
  return input.key === "Enter" && (input.ctrlKey || input.metaKey) && !input.isComposing
}
