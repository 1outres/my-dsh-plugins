import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "../src/client/config"
import { Config } from "../src/host/config"

describe("Host settings schema", () => {
  it("declares every browser setting and the Host-only fields", () => {
    expect(Object.keys(Config.dict ?? {}).sort()).toEqual(
      [...Object.keys(DEFAULT_CONFIG), "vapidSubject"].sort(),
    )
  })

  it("defaults push on and names a VAPID subject", () => {
    const value = Config({})

    expect(value.push.get()).toBe(true)
    expect(value.enabled.get()).toBe(true)
    expect(value.vapidSubject).toBe("https://github.com/1outres/my-dsh-plugins")
  })

  it("describes every field for the generated settings form", () => {
    for (const name of Object.keys(Config.dict ?? {})) {
      expect(Config.dict?.[name]?.meta.description, name).toBeTruthy()
    }
  })

  it("keeps the switches volatile and the VAPID subject plain", () => {
    expect(Config.dict?.push?.meta.volatile).toBe(true)
    expect(Config.dict?.vapidSubject?.meta.volatile).not.toBe(true)
  })

  it("rejects a value of the wrong type", () => {
    expect(() => Config({ push: "yes" } as never)).toThrow()
  })
})
