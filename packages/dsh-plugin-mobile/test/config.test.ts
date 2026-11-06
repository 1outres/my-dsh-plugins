import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, normalizeConfig } from "../src/client/config"
import { apply, Config } from "../src/index"

describe("settings", () => {
  it("falls back to the defaults for unwritten fields", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({})).toEqual({
      enterKey: "newline",
      swipe: true,
      fitKeyboard: true,
      blockPullToRefresh: true,
      autoFocusComposer: false,
    })
  })

  it("keeps valid values and rejects unknown ones", () => {
    expect(normalizeConfig({ enterKey: "send", swipe: false })).toMatchObject({
      enterKey: "send",
      swipe: false,
    })
    expect(normalizeConfig({ enterKey: 1, swipe: "yes" })).toMatchObject({
      enterKey: "newline",
      swipe: true,
    })
  })

  it("ignores the old layout fields the Harness now owns", () => {
    const legacy = { mode: "off", breakpoint: 1024 } as unknown as Partial<
      Record<keyof typeof DEFAULT_CONFIG, unknown>
    >
    expect(normalizeConfig(legacy)).toEqual(DEFAULT_CONFIG)
  })

  it("declares the same fields in the Host schema", () => {
    expect(Object.keys(Config.dict ?? {}).sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort())
    expect(() => Config({ enterKey: "nope" } as never)).toThrow()
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
