export type TitleCommit =
  | { readonly kind: "save"; readonly title: string }
  | { readonly kind: "revert" }
  | { readonly kind: "keep" }

export type DescriptionCommit =
  | { readonly kind: "save"; readonly description: string }
  | { readonly kind: "keep" }

export type NameCommit =
  | { readonly kind: "save"; readonly name: string }
  | { readonly kind: "cancel" }

export function titleCommit(draft: string, saved: string): TitleCommit {
  const title = draft.trim()
  if (title === "") return { kind: "revert" }
  if (title === saved) return draft === saved ? { kind: "keep" } : { kind: "revert" }
  return { kind: "save", title }
}

export function descriptionCommit(draft: string, saved: string): DescriptionCommit {
  if (draft === saved) return { kind: "keep" }
  return { kind: "save", description: draft }
}

export function nameCommit(draft: string, current: string): NameCommit {
  const name = draft.trim()
  if (name === "" || name === current) return { kind: "cancel" }
  return { kind: "save", name }
}

export function resyncDraft(draft: string, previousSaved: string, nextSaved: string): string {
  return draft === previousSaved ? nextSaved : draft
}
