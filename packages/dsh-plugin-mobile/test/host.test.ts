import { describe, expect, it, vi } from "vitest"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    readFileSync: vi.fn(() =>
      new TextEncoder().encode("self.addEventListener('install', () => {})"),
    ),
  }
})

import { createWorkerRoute, type WebResourceRoute } from "../src/host/worker-route"
import { apply } from "../src/index"

describe("service worker route", () => {
  it("serves the worker script at the site root", async () => {
    const route = createWorkerRoute("console.log('worker')")
    expect(route.kind).toBe("exact")
    expect(route.path).toBe("/dsh-mobile-sw.js")

    const response = await route.resource(new Request("http://localhost/dsh-mobile-sw.js"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(response.headers.get("service-worker-allowed")).toBe("/")
    expect(await response.text()).toBe("console.log('worker')")
  })

  it("serves the script from the bytes the Host read at startup", async () => {
    const route = createWorkerRoute(new TextEncoder().encode("self.registration"))
    const response = await route.resource(new Request("http://localhost/dsh-mobile-sw.js"))
    expect(await response.text()).toBe("self.registration")
  })
})

describe("mobile host half", () => {
  it("registers the route only when the composition has a web server", async () => {
    const routes: WebResourceRoute[] = []
    const ctx = {
      fiber: "fiber",
      inject: (deps: string[], callback: (child: unknown) => void) => {
        if (!deps.includes("webServer")) return
        callback({
          webServer: {
            register: (route: WebResourceRoute) => {
              routes.push(route)
              return () => {
                routes.splice(routes.indexOf(route), 1)
              }
            },
          },
          effect: (run: () => (() => void) | undefined) => run(),
        })
      },
    }

    apply(ctx as never)
    expect(routes).toHaveLength(1)
    const response = await routes[0].resource(new Request("http://localhost/dsh-mobile-sw.js"))
    expect(await response.text()).toContain("addEventListener")
  })

  it("starts without a web server", () => {
    const ctx = { fiber: "fiber", inject: () => {} }
    expect(() => apply(ctx as never)).not.toThrow()
  })
})
