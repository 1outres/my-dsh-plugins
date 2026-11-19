import { describe, expect, it } from "vitest"
import { USAGE_CSS } from "../src/client/styles"

describe("stylesheet", () => {
  it("does not paint its own box around the bar", () => {
    expect(USAGE_CSS).not.toContain("--dsw-alias-bg-base")
    expect(USAGE_CSS).not.toContain("border-top")
    expect(USAGE_CSS).toContain("height:24px")
  })

  it("keeps hover feedback on the content and the focus outline", () => {
    expect(USAGE_CSS).not.toContain(".dsh-cu-bar:hover{background")
    expect(USAGE_CSS).toContain(".dsh-cu-bar:hover{opacity:")
    expect(USAGE_CSS).toContain(".dsh-cu-bar:focus-visible")
  })
})
