import { describe, expect, it } from "vitest"
import { authorLabel } from "../src/host/author"
import { buildCardMessage } from "../src/host/message"
import { buildCard } from "./host-support"

const HEAD = "Task card #12 from the task board of this project."
const WORK =
  "Work on this card. Use the task_board tool with number 12 to comment on it or to move it to another column."

describe("authorLabel", () => {
  it("names the user and links an agent to its session", () => {
    expect(authorLabel({ kind: "user" })).toBe("user")
    expect(authorLabel({ kind: "agent", sessionId: "s1" })).toBe("agent s1")
  })
})

describe("buildCardMessage", () => {
  it("renders a card without a description or comments", () => {
    const card = buildCard({ number: 12, title: "Fix the login form" })

    expect(buildCardMessage(card, "In progress")).toBe(
      [HEAD, "Title: Fix the login form\nColumn: In progress", WORK].join("\n\n"),
    )
  })

  it("renders the description and the comments with author and ISO time", () => {
    const card = buildCard({
      number: 12,
      title: "Fix the login form",
      description: "The form drops spaces.",
      comments: [
        {
          id: "c1",
          author: { kind: "user" },
          body: "Please check the tokenizer.",
          createdAt: Date.parse("2026-11-24T08:00:00.000Z"),
        },
        {
          id: "c2",
          author: { kind: "agent", sessionId: "s1" },
          body: "I found the cause.\nIt is in the parser.",
          createdAt: Date.parse("2026-11-24T09:30:00.000Z"),
        },
      ],
    })

    expect(buildCardMessage(card, "In progress")).toBe(
      [
        HEAD,
        "Title: Fix the login form\nColumn: In progress",
        "Description:\nThe form drops spaces.",
        [
          "Comments:",
          "- user, 2026-11-24T08:00:00.000Z: Please check the tokenizer.",
          "- agent s1, 2026-11-24T09:30:00.000Z: I found the cause.",
          "  It is in the parser.",
        ].join("\n"),
        WORK,
      ].join("\n\n"),
    )
  })
})
