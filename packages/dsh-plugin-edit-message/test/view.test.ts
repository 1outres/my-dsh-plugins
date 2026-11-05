import type { ComponentType } from "react"
import { describe, expect, it } from "vitest"
import {
  editableMessage,
  findActionRow,
  type UserNodeProps,
  wrappedRenderer,
} from "../src/client/EditableUserMessage"
import type { StoredSlotEntry } from "../src/client/types"

function userNode(overrides: Partial<UserNodeProps["node"]> = {}): UserNodeProps["node"] {
  return {
    kind: "user",
    data: { content: [{ type: "text", text: "hi" }] },
    location: { kind: "step", turn: { turn: 3, start: { seq: 40 } }, step: { step: 1 } },
    ...overrides,
  }
}

describe("editableMessage", () => {
  it("accepts the prompt that opens a turn", () => {
    expect(editableMessage(userNode())).toEqual({
      turn: 3,
      turnStartSeq: 40,
      content: [{ type: "text", text: "hi" }],
      parts: { text: "hi", images: [], hasFiles: false },
    })
  })

  it("rejects steering, later steps, and turns without a known start", () => {
    expect(editableMessage(userNode({ kind: "steering" }))).toBeUndefined()
    expect(
      editableMessage(
        userNode({
          location: { kind: "step", turn: { turn: 3, start: { seq: 40 } }, step: { step: 2 } },
        }),
      ),
    ).toBeUndefined()
    expect(
      editableMessage(
        userNode({ location: { kind: "step", turn: { turn: 3 }, step: { step: 1 } } }),
      ),
    ).toBeUndefined()
    expect(editableMessage(userNode({ location: { kind: "session" } }))).toBeUndefined()
  })
})

const Self: ComponentType = () => null
const Shipped: ComponentType = () => null
const Above: ComponentType = () => null
const Steering: ComponentType = () => null

describe("wrappedRenderer", () => {
  it("wraps the next user renderer below this plugin's priority", () => {
    const entries: StoredSlotEntry[] = [
      { component: Above, options: { key: "user", priority: -200 } },
      { component: Self, options: { key: "user", priority: -100 } },
      { component: Steering, options: { key: "steering" } },
      { component: Shipped, options: { key: "user" } },
    ]
    expect(wrappedRenderer(entries, Self, -100)).toBe(Shipped)
  })

  it("finds nothing when only this plugin renders user messages", () => {
    expect(
      wrappedRenderer([{ component: Self, options: { key: "user", priority: -100 } }], Self, -100),
    ).toBeUndefined()
  })
})

describe("findActionRow", () => {
  it("picks the last element carrying data-clock", () => {
    const rows = [{ id: "a" }, { id: "b" }] as unknown as HTMLElement[]
    const root = {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe("[data-clock]")
        return rows
      },
    } as unknown as ParentNode
    expect(findActionRow(root)).toBe(rows[1])
  })

  it("returns null without an action row", () => {
    const root = { querySelectorAll: () => [] } as unknown as ParentNode
    expect(findActionRow(root)).toBeNull()
  })
})
