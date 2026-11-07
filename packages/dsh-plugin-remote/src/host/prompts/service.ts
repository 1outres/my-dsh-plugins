import type { Context } from "@deepseek-ai/cordis"
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"
import type { RemotePromptAnswer, RemotePromptEvent } from "../../shared/types"
import type { PromptBroker } from "./broker"

/**
 * The broker, kept off the public API. The Gateway calls Remote methods with a
 * Cordis service proxy as `this`, where a JS private field would throw, so the
 * field is symbol-keyed instead.
 */
const BROKER = Symbol("remotePromptBroker")

/**
 * Browser bridge: the card stream and the answer call. It carries only card
 * descriptions and user-entered values, never the transcript.
 */
export class RemotePromptService extends TypertRemoteService {
  [BROKER]: PromptBroker

  constructor(ctx: Context, broker: PromptBroker) {
    super(ctx, "remotePrompt")
    this[BROKER] = broker
  }

  @Remote({ mode: "stream" })
  async *prompts(signal?: AbortSignal): AsyncIterable<RemotePromptEvent> {
    const queue: RemotePromptEvent[] = []
    let wake: (() => void) | undefined
    const unsubscribe = this[BROKER].subscribe((event) => {
      queue.push(event)
      wake?.()
    })
    for (const prompt of this[BROKER].pending()) queue.push({ type: "prompt", prompt })
    try {
      while (signal?.aborted !== true) {
        const next = queue.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
          const onAbort = (): void => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
          }
          signal?.addEventListener("abort", onAbort, { once: true })
        })
        wake = undefined
      }
    } finally {
      unsubscribe()
    }
  }

  @Remote
  async answer(requestId: string, answer: RemotePromptAnswer): Promise<{ accepted: boolean }> {
    this[BROKER].answer(requestId, answer)
    return { accepted: true }
  }
}
