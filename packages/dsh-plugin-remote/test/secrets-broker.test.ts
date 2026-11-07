import { describe, expect, it } from "vitest"
import { PromptAbortedError, PromptAnswerError, PromptBroker } from "../src/host/prompts/broker"
import { SecretStore } from "../src/host/secrets/store"
import type { RemotePromptRequest } from "../src/shared/types"

const request: Omit<RemotePromptRequest, "id"> = {
  sessionId: "s",
  callId: "c",
  kind: "secret",
  title: "",
  fields: [{ name: "login", label: "Login password", masked: true }],
}

describe("SecretStore", () => {
  it("sets, reads, and deletes fields per session and target", () => {
    const store = new SecretStore()
    store.set("s", "web1", "login", "a")
    store.setMany("s", "web1", { sudo: "b" })
    expect(store.get("s", "web1", "login")).toBe("a")
    expect(store.names("s", "web1", ["login", "sudo", "enable"])).toEqual([
      { name: "login", present: true },
      { name: "sudo", present: true },
      { name: "enable", present: false },
    ])
    store.deleteField("s", "web1", "login")
    expect(store.has("s", "web1", "login")).toBe(false)
    store.deleteTarget("s", "web1")
    expect(store.has("s", "web1", "sudo")).toBe(false)
  })
})

describe("PromptBroker", () => {
  it("resolves a request through answer", async () => {
    const broker = new PromptBroker()
    const answer = broker.ask(request)
    const prompt = broker.pending()[0] as RemotePromptRequest
    broker.answer(prompt.id, { decision: "submit", values: { login: "secret" } })
    await expect(answer).resolves.toEqual({ decision: "submit", values: { login: "secret" } })
    expect(broker.pending()).toEqual([])
  })

  it("rejects an answer with an undeclared field", async () => {
    const broker = new PromptBroker()
    const answer = broker.ask(request)
    const prompt = broker.pending()[0] as RemotePromptRequest
    expect(() => broker.answer(prompt.id, { decision: "submit", values: { other: "x" } })).toThrow(
      PromptAnswerError,
    )
    expect(() => broker.answer(prompt.id, { decision: "reject" })).toThrow(PromptAnswerError)
    broker.answer(prompt.id, { decision: "submit", values: { login: "x" } })
    await answer
  })

  it("rejects when the tool call is cancelled", async () => {
    const broker = new PromptBroker()
    const controller = new AbortController()
    const answer = broker.ask(request, controller.signal)
    controller.abort(new Error("stop"))
    await expect(answer).rejects.toBeInstanceOf(PromptAbortedError)
    expect(broker.pending()).toEqual([])
  })

  it("reports pending prompts until they are answered", async () => {
    const broker = new PromptBroker()
    const answer = broker.ask(request)
    expect(broker.pending()).toHaveLength(1)
    const prompt = broker.pending()[0] as RemotePromptRequest
    broker.answer(prompt.id, { decision: "submit", values: { login: "x" } })
    await answer
    expect(broker.pending()).toEqual([])
  })
})
