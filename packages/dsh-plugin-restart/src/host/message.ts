import { type ContextFormed, createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm"

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    restart: { kind: "restart" } & ContextFormed
  }
}

/**
 * Build one user message that carries restart text into a session.
 * @param text - what the message says.
 * @returns a frozen user message with the `restart` source.
 */
export function createRestartMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "restart" } })
}
