import { describe, expect, it } from "vitest"
import { USAGE_CSS } from "../src/client/styles"

describe("stylesheet", () => {
  it("paints the bar surface through the bottom inset", () => {
    expect(USAGE_CSS).toContain("background:var(--dsw-alias-bg-base)")
    expect(USAGE_CSS).toContain("border-top:1px solid var(--dsw-alias-border-l1)")
    expect(USAGE_CSS).toContain("var(--dsh-shell-bottom-inset-bottom, 0px)")
    expect(USAGE_CSS).toContain("height:24px")
  })

  it("pads the bar button by the row's horizontal insets", () => {
    expect(USAGE_CSS).toContain("var(--dsh-shell-bottom-inset-left, 0px)")
    expect(USAGE_CSS).toContain("var(--dsh-shell-bottom-inset-right, 0px)")
    expect(USAGE_CSS).toContain("calc(10px + var(--dsh-shell-bottom-inset-left, 0px))")
    expect(USAGE_CSS).toContain("calc(10px + var(--dsh-shell-bottom-inset-right, 0px))")
  })

  it("keeps the hover surface and the focus outline", () => {
    expect(USAGE_CSS).toContain(
      ".dsh-cu-bar:hover{background:var(--dsw-alias-interactive-bg-hover)}",
    )
    expect(USAGE_CSS).toContain(".dsh-cu-bar:focus-visible")
  })
})
