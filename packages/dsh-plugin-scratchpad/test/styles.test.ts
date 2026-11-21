import { describe, expect, it } from "vitest"
import { QUICK_START_ATTR } from "../src/client/quick-start"
import { SCRATCH_CSS } from "../src/client/styles"

const css = SCRATCH_CSS.replace(/\s+/g, " ")

describe("stylesheet", () => {
  it("shares the footer row with the today button", () => {
    expect(css).toContain("flex: 1 1 0")
    expect(css).toContain("min-width: 0")
    expect(css).not.toContain("width: calc(100% + 4px)")
    expect(css).toContain("height: 42px")
    expect(css).toContain("margin: 8px -2px 0")
    expect(css).toContain("padding: 0 10px 0 8px")
    expect(css).toContain("border-radius: 12px")
    expect(css).toContain(".dsh-scratch-footer:hover:not(:disabled)")
  })

  it("shows only the short label when another quick start button shares the row", () => {
    expect(css).toContain(".dsh-scratch-label-short { display: none; }")
    expect(css).toContain(
      `[data-slot="sidebar.footer.action"]:has(> [${QUICK_START_ATTR}]:not(.dsh-scratch-footer)) > .dsh-scratch-footer .dsh-scratch-label-full { display: none; }`,
    )
    expect(css).toContain(
      `[data-slot="sidebar.footer.action"]:has(> [${QUICK_START_ATTR}]:not(.dsh-scratch-footer)) > .dsh-scratch-footer .dsh-scratch-label-short { display: inline; }`,
    )
  })

  it("draws a divider after another quick start button", () => {
    expect(css).toContain(
      `[${QUICK_START_ATTR}] ~ .dsh-scratch-footer[${QUICK_START_ATTR}]:not([data-rail]) { position: relative; }`,
    )
    expect(css).toContain(
      `[${QUICK_START_ATTR}] ~ .dsh-scratch-footer[${QUICK_START_ATTR}]:not([data-rail])::before { content: ""; position: absolute; left: 0; top: 12px; bottom: 12px; width: 1px; background: var(--dsw-alias-border-l3); }`,
    )
  })

  it("stacks the two rail icons", () => {
    expect(css).toContain(
      `:has(> [data-slot="sidebar.footer.action"] > [${QUICK_START_ATTR}][data-rail] ~ [${QUICK_START_ATTR}][data-rail]) { flex-direction: column; align-items: center; gap: 4px; }`,
    )
    expect(css).toContain(".dsh-scratch-footer[data-rail] {")
    expect(css).toContain("flex: none")
    expect(css).toContain("border-radius: 50%")
  })
})
