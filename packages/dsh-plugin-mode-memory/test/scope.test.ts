import { describe, expect, it } from "vitest"
import { createCreateScope } from "../src/host/scope"

describe("createCreateScope", () => {
  it("is inactive outside a run", () => {
    expect(createCreateScope().active()).toBe(false)
  })

  it("is active inside the operation and false after it", () => {
    const scope = createCreateScope()
    expect(scope.run(() => scope.active())).toBe(true)
    expect(scope.active()).toBe(false)
  })

  it("stays active across awaits inside the operation", async () => {
    const scope = createCreateScope()
    const seen = await scope.run(async () => {
      expect(scope.active()).toBe(true)
      await Promise.resolve()
      expect(scope.active()).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
      return scope.active()
    })
    expect(seen).toBe(true)
    expect(scope.active()).toBe(false)
  })

  it("does not leak into concurrent work started outside", async () => {
    const scope = createCreateScope()
    let release: (() => void) | undefined
    const inside = scope.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      expect(scope.active()).toBe(true)
    })
    await Promise.resolve()
    expect(scope.active()).toBe(false)
    release?.()
    await inside
    expect(scope.active()).toBe(false)
  })

  it("does not stay active after an async operation resolves", async () => {
    const scope = createCreateScope()
    await scope.run(async () => {
      await Promise.resolve()
    })
    expect(scope.active()).toBe(false)
    await Promise.resolve()
    expect(scope.active()).toBe(false)
  })
})
