import { describe, expect, it, vi } from "vitest"
import { createDrawerSource, DRAWER_ATTRIBUTE, type Observe } from "../src/client/drawer"
import { FRAME_ANCHOR } from "../src/client/frame"

interface FakeFrame {
  isConnected: boolean
  hasAttribute(name: string): boolean
}

function frame(attributes: string[] = []): FakeFrame {
  return {
    isConnected: true,
    hasAttribute: (name: string) => attributes.includes(name),
  }
}

function page(initial: FakeFrame | null) {
  const state = { frame: initial }
  const document = {
    documentElement: {},
    querySelector: (selector: string) =>
      selector === FRAME_ANCHOR && state.frame !== null ? { parentElement: state.frame } : null,
  } as unknown as Document
  return { document, state }
}

function recorder() {
  const calls: {
    target: unknown
    options: MutationObserverInit
    callback: () => void
    disconnect: ReturnType<typeof vi.fn>
  }[] = []
  const observe: Observe = (target, options, callback) => {
    const disconnect = vi.fn()
    calls.push({ target, options, callback, disconnect })
    return { disconnect }
  }
  return { observe, calls }
}

describe("drawer source", () => {
  it("starts off when the frame is not mounted", () => {
    const { document } = page(null)
    const { observe } = recorder()
    const source = createDrawerSource(document, observe)
    expect(source.get()).toBe(false)
    source.dispose()
  })

  it("reads the drawer attribute and follows changes", () => {
    const mounted = frame([DRAWER_ATTRIBUTE])
    const { document } = page(mounted)
    const { observe, calls } = recorder()
    const source = createDrawerSource(document, observe)
    expect(source.get()).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].options).toMatchObject({
      attributes: true,
      attributeFilter: [DRAWER_ATTRIBUTE],
    })

    const listener = vi.fn()
    const off = source.subscribe(listener)
    mounted.hasAttribute = () => false
    calls[1].callback()
    expect(source.get()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    source.dispose()
  })

  it("attaches when the frame mounts later", () => {
    const { document, state } = page(null)
    const { observe, calls } = recorder()
    const source = createDrawerSource(document, observe)
    expect(source.get()).toBe(false)

    state.frame = frame([DRAWER_ATTRIBUTE])
    calls[0].callback()
    expect(source.get()).toBe(true)
    expect(calls).toHaveLength(2)
    source.dispose()
  })

  it("re-attaches after the frame is replaced", () => {
    const first = frame([DRAWER_ATTRIBUTE])
    const { document, state } = page(first)
    const { observe, calls } = recorder()
    const source = createDrawerSource(document, observe)
    expect(source.get()).toBe(true)

    first.isConnected = false
    state.frame = frame([])
    calls[0].callback()
    expect(source.get()).toBe(false)
    expect(calls[1].disconnect).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(3)
    source.dispose()
  })

  it("disconnects both observers on dispose", () => {
    const { document } = page(frame([DRAWER_ATTRIBUTE]))
    const { observe, calls } = recorder()
    const source = createDrawerSource(document, observe)
    source.dispose()
    expect(calls[0].disconnect).toHaveBeenCalledTimes(1)
    expect(calls[1].disconnect).toHaveBeenCalledTimes(1)
  })
})
