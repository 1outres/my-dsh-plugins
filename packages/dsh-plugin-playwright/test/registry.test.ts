import type { Agent } from "@deepseek-ai/dsh-agent"
import { describe, expect, test } from "vitest"
import { SessionRegistry } from "../src/host/registry"

class FakeSession {
  alive = true
  disposals = 0

  constructor(readonly id: string) {}

  isAlive(): boolean {
    return this.alive
  }

  async dispose(): Promise<void> {
    this.disposals += 1
    this.alive = false
  }
}

class FakeFactory {
  readonly created: FakeSession[] = []
  readonly agents: Agent[] = []
  readonly #gates: Array<{ promise: Promise<void>; resolve: () => void }> = []
  failure: Error | undefined

  holdNext(): () => void {
    let resolve = () => {}
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.#gates.push({ promise, resolve })
    return resolve
  }

  async create(agent: Agent): Promise<FakeSession> {
    this.agents.push(agent)
    const session = new FakeSession(`session-${String(this.created.length + 1)}`)
    this.created.push(session)
    if (this.failure !== undefined) {
      const failure = this.failure
      this.failure = undefined
      throw failure
    }
    const gate = this.#gates.shift()
    if (gate !== undefined) await gate.promise
    return session
  }
}

function agent(id: string): Agent {
  return { id } as Agent
}

describe("SessionRegistry", () => {
  test("creates one session lazily and reuses it", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    expect(factory.created).toHaveLength(0)
    const first = await registry.acquire(agent("root"))
    const second = await registry.acquire(agent("root"))
    expect(factory.created).toHaveLength(1)
    expect(second).toBe(first)
  })

  test("keeps one session per root", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    const first = await registry.acquire(agent("a"))
    const second = await registry.acquire(agent("b"))
    expect(first).not.toBe(second)
    expect(factory.agents.map((item) => item.id)).toEqual(["a", "b"])
  })

  test("dedupes concurrent first calls for one root", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    const release = factory.holdNext()
    const calls = Array.from({ length: 5 }, async () => registry.acquire(agent("root")))
    expect(factory.created).toHaveLength(1)
    release()
    const sessions = await Promise.all(calls)
    expect(new Set(sessions).size).toBe(1)
    expect(factory.created).toHaveLength(1)
  })

  test("disposes a session and creates a new one for the next call", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    const first = await registry.acquire(agent("root"))
    await registry.disposeSession("root")
    expect(first.alive).toBe(false)
    expect(first.disposals).toBe(1)
    const second = await registry.acquire(agent("root"))
    expect(second).not.toBe(first)
    expect(factory.created).toHaveLength(2)
  })

  test("replaces a dead session and disposes it", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    const first = await registry.acquire(agent("root"))
    first.alive = false
    const second = await registry.acquire(agent("root"))
    expect(second).not.toBe(first)
    expect(first.disposals).toBe(1)
  })

  test("does not keep a session disposed while it was starting", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    const release = factory.holdNext()
    const creating = registry.acquire(agent("root"))
    const disposal = registry.disposeSession("root")
    release()
    await expect(creating).rejects.toThrow(/disposed while its browser was starting/)
    await disposal
    expect(factory.created[0]?.disposals).toBe(1)
    const next = await registry.acquire(agent("root"))
    expect(next).not.toBe(factory.created[0])
  })

  test("propagates a creation failure and allows a retry", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    factory.failure = new Error("launch failed")
    await expect(registry.acquire(agent("root"))).rejects.toThrow("launch failed")
    const session = await registry.acquire(agent("root"))
    expect(session.isAlive()).toBe(true)
  })

  test("disposes every session and refuses new work", async () => {
    const factory = new FakeFactory()
    const registry = new SessionRegistry(factory)
    const first = await registry.acquire(agent("a"))
    const second = await registry.acquire(agent("b"))
    await registry.disposeAll()
    expect(first.disposals).toBe(1)
    expect(second.disposals).toBe(1)
    await expect(registry.acquire(agent("a"))).rejects.toThrow(/closed/)
  })
})
