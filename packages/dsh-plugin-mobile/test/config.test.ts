import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, normalizeConfig } from "../src/client/config"
import { apply, Config } from "../src/index"

describe("settings", () => {
  it("falls back to the defaults for unwritten fields", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({})).toEqual({
      mode: "auto",
      breakpoint: 768,
      enterKey: "newline",
      swipe: true,
      fitKeyboard: true,
      blockPullToRefresh: true,
      autoFocusComposer: false,
    })
  })

  it("keeps valid values and rejects unknown ones", () => {
    expect(normalizeConfig({ mode: "always", enterKey: "send", swipe: false })).toMatchObject({
      mode: "always",
      enterKey: "send",
      swipe: false,
    })
    expect(normalizeConfig({ mode: "tablet", enterKey: 1, swipe: "yes" })).toMatchObject({
      mode: "auto",
      enterKey: "newline",
      swipe: true,
    })
  })

  it("clamps the breakpoint into the range the frame supports", () => {
    expect(normalizeConfig({ breakpoint: 100 }).breakpoint).toBe(360)
    expect(normalizeConfig({ breakpoint: 4000 }).breakpoint).toBe(1024)
    expect(normalizeConfig({ breakpoint: 600.4 }).breakpoint).toBe(600)
    expect(normalizeConfig({ breakpoint: Number.NaN }).breakpoint).toBe(768)
  })

  it("declares the same fields in the Host schema", () => {
    expect(Object.keys(Config.dict ?? {}).sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort())
    expect(() => Config({ mode: "nope" } as never)).toThrow()
  })

  it("tells Settings the plugin ships its own page", () => {
    const configured: unknown[] = []
    const ctx = {
      fiber: "fiber",
      inject: (deps: string[], callback: (child: unknown) => void) => {
        expect(deps).toEqual(["settings"])
        callback({
          settings: {
            configure: (presentation: unknown, owner: unknown) => {
              configured.push([presentation, owner])
              return () => {}
            },
          },
          effect: (run: () => unknown) => run(),
        })
      },
    }
    apply(ctx as never)
    expect(configured).toEqual([[{ auto: false }, "fiber"]])
  })
})
