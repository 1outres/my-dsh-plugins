import { describe, expect, it } from "vitest"
import { cardPlace, columnOfCard } from "../src/client/board"
import { cardFace, commentView } from "../src/client/view"
import { BOARD, CARD_ONE, CARD_THREE, CARD_TWO, SNAPSHOT, translate } from "./client-support"

const NOW = 1000 + 5 * 60 * 1000

describe("card face", () => {
  it("shows the number, title, first description line and what exists", () => {
    expect(cardFace(CARD_ONE)).toEqual({
      number: "#1",
      title: "Write the bridge",
      detail: "First line",
      comments: 1,
      linked: true,
    })
  })

  it("leaves out what does not exist", () => {
    expect(cardFace(CARD_TWO)).toEqual({
      number: "#2",
      title: "Draw the board",
      detail: undefined,
      comments: undefined,
      linked: false,
    })
  })
})

describe("comment view", () => {
  it("shows a user comment with a relative and a full time", () => {
    const comment = CARD_ONE.comments[0]
    if (comment === undefined) throw new Error("expected a comment")
    const view = commentView(comment, NOW, "en", translate)
    expect(view).toMatchObject({
      id: "comment-1",
      author: "You",
      agentId: undefined,
      relative: "5 minutes ago",
      body: "Looks good",
      deletable: true,
    })
    expect(view.full).toContain("1970")
  })

  it("shows an agent comment with its short session id", () => {
    const view = commentView(
      {
        id: "c2",
        author: { kind: "agent", sessionId: "abcdef123456" },
        body: "Done",
        createdAt: NOW,
      },
      NOW,
      "en",
      translate,
    )
    expect(view).toMatchObject({
      author: "Agent",
      agentId: "abcdef12",
      relative: "now",
      deletable: false,
    })
  })
})

describe("card place", () => {
  it("finds the column of a card", () => {
    expect(columnOfCard(BOARD, 3)?.id).toBe("done")
    expect(columnOfCard(BOARD, 9)).toBeUndefined()
  })

  it("places a card on the board for keyboard moves", () => {
    expect(cardPlace(BOARD, CARD_TWO.number)).toEqual({
      column: 0,
      card: 1,
      columnCount: 3,
      cardCount: 2,
    })
    expect(cardPlace(BOARD, CARD_THREE.number)).toEqual({
      column: 2,
      card: 0,
      columnCount: 3,
      cardCount: 1,
    })
    expect(cardPlace(SNAPSHOT.board, 9)).toBeUndefined()
  })
})
