import { randomUUID } from "node:crypto"
import type { RemotePromptAnswer, RemotePromptEvent, RemotePromptRequest } from "../../shared/types"

export class PromptAbortedError extends Error {
  readonly code = "REMOTE_PROMPT_ABORTED"

  constructor() {
    super("The user did not answer before the tool call was cancelled")
    this.name = "PromptAbortedError"
  }
}

export class PromptAnswerError extends Error {
  readonly code = "REMOTE_PROMPT_ANSWER_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "PromptAnswerError"
  }
}

interface Pending {
  request: RemotePromptRequest
  resolve: (answer: RemotePromptAnswer) => void
  reject: (error: Error) => void
  signal: AbortSignal | undefined
  onAbort: (() => void) | undefined
}

type Listener = (event: RemotePromptEvent) => void

/**
 * Waits for a browser card to answer one prompt. Values stay in this process;
 * the broker never writes them to the session log.
 */
export class PromptBroker {
  readonly #pending = new Map<string, Pending>()
  readonly #listeners = new Set<Listener>()

  get size(): number {
    return this.#pending.size
  }

  ask(input: Omit<RemotePromptRequest, "id">, signal?: AbortSignal): Promise<RemotePromptAnswer> {
    if (signal?.aborted === true) return Promise.reject(new PromptAbortedError())
    const id = randomUUID()
    const request: RemotePromptRequest = { ...input, id }
    const { promise, resolve, reject } = deferred<RemotePromptAnswer>()
    const onAbort = (): void => {
      this.#close(id)
      reject(new PromptAbortedError())
    }
    const pending: Pending = { request, resolve, reject, signal, onAbort }
    this.#pending.set(id, pending)
    signal?.addEventListener("abort", onAbort, { once: true })
    this.#emit({ type: "prompt", prompt: request })
    return promise
  }

  answer(id: string, answer: RemotePromptAnswer): void {
    const pending = this.#pending.get(id)
    if (pending === undefined)
      throw new PromptAnswerError("This prompt is no longer waiting for an answer")
    assertAnswer(pending.request, answer)
    this.#settle(id)
    pending.resolve(answer)
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Prompts that still wait for an answer, so a reconnecting card can show them. */
  pending(): RemotePromptRequest[] {
    return [...this.#pending.values()].map((pending) => pending.request)
  }

  dispose(): void {
    for (const [id, pending] of [...this.#pending]) {
      this.#close(id)
      pending.reject(new PromptAbortedError())
    }
    this.#listeners.clear()
  }

  #settle(id: string): void {
    const pending = this.#pending.get(id)
    if (pending === undefined) return
    this.#pending.delete(id)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener("abort", pending.onAbort)
    }
    this.#emit({ type: "close", id })
  }

  #close(id: string): void {
    this.#settle(id)
  }

  #emit(event: RemotePromptEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event)
      } catch {
        // A broken card connection must not fail the tool call that is waiting.
      }
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve: (value: T) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function assertAnswer(request: RemotePromptRequest, answer: RemotePromptAnswer): void {
  if (
    answer.decision !== "approve" &&
    answer.decision !== "reject" &&
    answer.decision !== "submit"
  ) {
    throw new PromptAnswerError("Unknown answer decision")
  }
  if (request.kind === "register" && answer.decision === "submit") {
    throw new PromptAnswerError("A registration card accepts or rejects the target")
  }
  if (request.kind === "hostkey" && answer.decision === "submit") {
    throw new PromptAnswerError("A host key card accepts or rejects the key")
  }
  if (request.kind === "secret" && answer.decision !== "submit") {
    throw new PromptAnswerError("A secret card needs a value")
  }
  if (answer.values !== undefined) {
    const declared = new Set(request.fields.map((field) => field.name))
    for (const [name, value] of Object.entries(answer.values)) {
      if (!declared.has(name))
        throw new PromptAnswerError(`${JSON.stringify(name)} is not a field of this card`)
      if (typeof value !== "string")
        throw new PromptAnswerError(`${JSON.stringify(name)} must be a string`)
    }
  }
  if (request.kind === "secret") {
    const field = request.fields[0]
    if (field !== undefined && answer.values?.[field.name] === undefined) {
      throw new PromptAnswerError("A secret card needs a value for its field")
    }
  }
}
