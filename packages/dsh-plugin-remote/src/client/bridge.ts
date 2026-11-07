import type { RemotePromptAnswer, RemotePromptEvent, RemotePromptRequest } from "../shared/types"
import type {
  ClientContext,
  PromptBridge,
  PromptRemote,
  RemoteAnswerResult,
  RemoteStreamHandle,
} from "./types"

const PACKAGE = "@1outres/dsh-plugin-remote"

/** The Host method names and the wire names must stay in sync with the Host service. */
const codec = {
  mode: "strict" as const,
  typeSymbol: "@1outres/dsh-plugin-remote/json",
  create: () => ({ parse: (value: unknown) => value }),
}

const contribution = {
  package: PACKAGE,
  descriptors: [
    {
      id: `${PACKAGE}#prompts`,
      service: "remotePrompt",
      namespace: "remotePrompt",
      method: "prompts",
      mode: "stream",
      invocation: { kind: "direct" },
      parameters: [],
      cancellation: { parameter: "signal" },
      result: codec,
    },
    {
      id: `${PACKAGE}#answer`,
      service: "remotePrompt",
      namespace: "remotePrompt",
      method: "answer",
      invocation: { kind: "direct" },
      parameters: [
        { name: "requestId", wire: "requestId", source: "json", codec },
        { name: "answer", wire: "answer", source: "json", codec },
      ],
      result: codec,
    },
  ],
}

const DELAY_MS = 1000

class HostPromptBridge implements PromptBridge {
  readonly #ctx: ClientContext
  readonly #byCall = new Map<string, RemotePromptRequest>()
  readonly #callOf = new Map<string, string>()
  readonly #listeners = new Set<() => void>()
  #disposed = false
  #handle: RemoteStreamHandle | undefined

  constructor(ctx: ClientContext) {
    this.#ctx = ctx
  }

  start(): void {
    void this.#pump()
  }

  get(callId: string): RemotePromptRequest | undefined {
    return this.#byCall.get(callId)
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  async answer(prompt: RemotePromptRequest, answer: RemotePromptAnswer): Promise<void> {
    const result: RemoteAnswerResult = await promptRemote(this.#ctx).answer(prompt.id, answer)
    if (!result.ok) throw new Error(result.error?.message ?? "The Host refused the answer")
  }

  dispose(): void {
    this.#disposed = true
    this.#handle?.dispose()
    this.#handle = undefined
    this.#byCall.clear()
    this.#callOf.clear()
    this.#listeners.clear()
  }

  async #pump(): Promise<void> {
    while (!this.#disposed) {
      try {
        this.#byCall.clear()
        this.#callOf.clear()
        this.#notify()
        const handle = promptRemote(this.#ctx).prompts()
        this.#handle = handle
        for await (const event of handle) {
          this.#apply(event)
          if (this.#disposed) break
        }
      } catch {
        if (this.#disposed) return
        await delay(DELAY_MS)
      } finally {
        this.#handle = undefined
      }
    }
  }

  #apply(event: RemotePromptEvent): void {
    if (event.type === "prompt") {
      this.#byCall.set(event.prompt.callId, event.prompt)
      this.#callOf.set(event.prompt.id, event.prompt.callId)
    } else {
      const callId = this.#callOf.get(event.id)
      if (callId !== undefined) {
        this.#callOf.delete(event.id)
        this.#byCall.delete(callId)
      }
    }
    this.#notify()
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}

/** The plugin mounts this namespace itself, so an inject would deadlock. */
function promptRemote(ctx: ClientContext): PromptRemote {
  const remote = ctx.get("remote.remotePrompt")
  if (remote === undefined) throw new Error("The remote prompt stream is not mounted")
  return remote as PromptRemote
}

export async function createPromptBridge(ctx: ClientContext): Promise<PromptBridge> {
  await ctx.remote.$mount(contribution)
  const bridge = new HostPromptBridge(ctx)
  bridge.start()
  return bridge
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
