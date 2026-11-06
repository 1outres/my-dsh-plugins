import { describe, expect, it } from "vitest"
import { findFrame, isExpanded, swipeBlocked } from "../src/client/frame"

function frame(attributes: string[]) {
  return { hasAttribute: (name: string) => attributes.includes(name) }
}

function root(frameAttributes: string[] | null, modal = false) {
  return {
    querySelector: (selector: string) => {
      if (selector === "[data-rightbar-col]") {
        return frameAttributes === null ? null : { parentElement: frame(frameAttributes) }
      }
      if (selector === "[aria-modal='true']") return modal ? { parentElement: null } : null
      return null
    },
  }
}

interface Probe {
  scrollWidth: number
  clientWidth: number
  parentElement: Probe | null
  overflow?: string
  control?: boolean
  closest(selector: string): unknown
}

function probe(options: Partial<Probe> = {}, parent: Probe | null = null): Probe {
  const node: Probe = {
    scrollWidth: 100,
    clientWidth: 100,
    parentElement: parent,
    ...options,
    closest: () => (options.control === true ? {} : null),
  }
  return node
}

const overflowOf = (element: Probe) => element.overflow ?? "visible"

describe("frame state", () => {
  it("reads the sidebar state from the frame attributes", () => {
    expect(isExpanded(findFrame(root([])))).toBe(true)
    expect(isExpanded(findFrame(root(["data-sidebar-collapsed"])))).toBe(false)
    expect(isExpanded(findFrame(root(null)))).toBe(false)
  })
})

describe("swipe blocking", () => {
  it("lets an ordinary touch through", () => {
    expect(swipeBlocked(probe({}, probe()) as never, root([]), overflowOf as never)).toBe(false)
    expect(swipeBlocked(null, root([]), overflowOf as never)).toBe(false)
  })

  it("blocks while the right panel covers the screen or a modal is open", () => {
    expect(
      swipeBlocked(probe() as never, root(["data-rightbar-fullscreen"]), overflowOf as never),
    ).toBe(true)
    expect(swipeBlocked(probe() as never, root([], true), overflowOf as never)).toBe(true)
  })

  it("blocks form controls and sideways scrollers", () => {
    expect(swipeBlocked(probe({ control: true }) as never, root([]), overflowOf as never)).toBe(
      true,
    )
    const scroller = probe({ scrollWidth: 400, clientWidth: 300, overflow: "auto" })
    expect(swipeBlocked(probe({}, scroller) as never, root([]), overflowOf as never)).toBe(true)
    const clipped = probe({ scrollWidth: 400, clientWidth: 300, overflow: "hidden" })
    expect(swipeBlocked(probe({}, clipped) as never, root([]), overflowOf as never)).toBe(false)
  })
})
