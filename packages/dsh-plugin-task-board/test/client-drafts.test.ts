import { describe, expect, it } from "vitest"
import { descriptionCommit, nameCommit, resyncDraft, titleCommit } from "../src/client/drafts"

describe("drafts", () => {
  it("saves a changed title trimmed", () => {
    expect(titleCommit("  New  ", "Old")).toEqual({ kind: "save", title: "New" })
  })

  it("reverts an empty title or one that only gained spaces", () => {
    expect(titleCommit("   ", "Old")).toEqual({ kind: "revert" })
    expect(titleCommit("Old  ", "Old")).toEqual({ kind: "revert" })
  })

  it("keeps an unchanged title", () => {
    expect(titleCommit("Old", "Old")).toEqual({ kind: "keep" })
  })

  it("saves a changed description as typed", () => {
    expect(descriptionCommit("Body\n", "Body")).toEqual({ kind: "save", description: "Body\n" })
    expect(descriptionCommit("", "Body")).toEqual({ kind: "save", description: "" })
    expect(descriptionCommit("Body", "Body")).toEqual({ kind: "keep" })
  })

  it("saves a changed name and cancels an empty or equal one", () => {
    expect(nameCommit(" Review ", "Done")).toEqual({ kind: "save", name: "Review" })
    expect(nameCommit("  ", "Done")).toEqual({ kind: "cancel" })
    expect(nameCommit("Done ", "Done")).toEqual({ kind: "cancel" })
    expect(nameCommit("New", "")).toEqual({ kind: "save", name: "New" })
  })

  it("follows a new saved value only while the draft is untouched", () => {
    expect(resyncDraft("Old", "Old", "New")).toBe("New")
    expect(resyncDraft("Typing", "Old", "New")).toBe("Typing")
  })
})
