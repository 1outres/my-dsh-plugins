import type { Agent } from "@deepseek-ai/dsh-agent"

export interface ManagedSession {
  isAlive(): boolean
  dispose(): Promise<void>
}

export interface SessionFactory<Session extends ManagedSession> {
  create(root: Agent): Promise<Session>
}

export class SessionRegistry<Session extends ManagedSession> {
  readonly #factory: SessionFactory<Session>
  readonly #sessions = new Map<string, Session>()
  readonly #pending = new Map<string, Promise<Session>>()
  readonly #epochs = new Map<string, number>()
  #closed = false

  constructor(factory: SessionFactory<Session>) {
    this.#factory = factory
  }

  async acquire(root: Agent): Promise<Session> {
    if (this.#closed) throw new Error("The Playwright runtime is closed")
    const current = this.#sessions.get(root.id)
    if (current?.isAlive()) return current
    const pending = this.#pending.get(root.id)
    if (pending !== undefined) return await pending
    const creation = this.#create(root)
    this.#pending.set(root.id, creation)
    try {
      return await creation
    } finally {
      if (this.#pending.get(root.id) === creation) this.#pending.delete(root.id)
    }
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.#epochs.set(sessionId, (this.#epochs.get(sessionId) ?? 0) + 1)
    const pending = this.#pending.get(sessionId)
    if (pending !== undefined) await pending.catch(() => undefined)
    const session = this.#sessions.get(sessionId)
    if (session === undefined) return
    this.#sessions.delete(sessionId)
    await session.dispose()
  }

  async disposeAll(): Promise<void> {
    this.#closed = true
    await Promise.allSettled([...this.#pending.values()])
    const sessions = [...this.#sessions.values()]
    this.#sessions.clear()
    const results = await Promise.allSettled(sessions.map(async (session) => session.dispose()))
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    )
    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to dispose one or more Playwright sessions")
    }
  }

  async #create(root: Agent): Promise<Session> {
    const stale = this.#sessions.get(root.id)
    if (stale !== undefined) {
      this.#sessions.delete(root.id)
      await stale.dispose()
    }
    const epoch = this.#epochs.get(root.id) ?? 0
    const session = await this.#factory.create(root)
    if (this.#closed || (this.#epochs.get(root.id) ?? 0) !== epoch) {
      await session.dispose()
      throw new Error("The Playwright session was disposed while its browser was starting")
    }
    this.#sessions.set(root.id, session)
    return session
  }
}
