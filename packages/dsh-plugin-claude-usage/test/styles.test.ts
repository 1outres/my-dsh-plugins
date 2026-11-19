import { describe, expect, it } from "vitest"
import { USAGE_CSS } from "../src/client/styles"

describe("stylesheet", () => {
  it("copies the scratch footer row metrics", () => {
    expect(USAGE_CSS).toContain(".dsh-cu-footer-root{display:contents}")
    expect(USAGE_CSS).toContain("width:calc(100% + 4px)")
    expect(USAGE_CSS).toContain("height:42px")
    expect(USAGE_CSS).toContain("margin:8px -2px 0")
    expect(USAGE_CSS).toContain("padding:0 10px 0 8px")
    expect(USAGE_CSS).toContain("border-radius:12px")
    expect(USAGE_CSS).toContain("font-size:14px")
    expect(USAGE_CSS).toContain("gap:8px")
  })

  it("keeps the hover and focus behavior", () => {
    expect(USAGE_CSS).toContain(
      ".dsh-cu-footer:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
    )
    expect(USAGE_CSS).toContain(".dsh-cu-footer:focus-visible")
  })

  it("turns the row into a circular rail meter", () => {
    expect(USAGE_CSS).toContain(".dsh-cu-footer[data-rail]{")
    expect(USAGE_CSS).toContain("width:36px")
    expect(USAGE_CSS).toContain("height:36px")
    expect(USAGE_CSS).toContain("border-radius:50%")
    expect(USAGE_CSS).toContain(".dsh-cu-ring")
  })

  it("has no bottom bar or phone-specific rules left", () => {
    expect(USAGE_CSS).not.toContain("dsh-cu-bar")
    expect(USAGE_CSS).not.toContain("dsh-cu-root")
    expect(USAGE_CSS).not.toContain("--dsh-shell-bottom-inset")
    expect(USAGE_CSS).not.toContain("shell.bottom")
    expect(USAGE_CSS).not.toContain("@media")
  })
})
