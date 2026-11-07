import type { ComponentType } from "react"
import type { RemotePromptAnswer, RemotePromptEvent, RemotePromptRequest } from "../shared/types"

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: Record<string, unknown>, component: ComponentType<any>): () => void
}

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface RemoteAnswerResult {
  ok: boolean
  value?: { accepted: boolean }
  error?: { message?: string }
}

export interface RemoteStreamHandle extends AsyncIterable<RemotePromptEvent> {
  dispose(): void
}

export interface PromptRemote {
  prompts(): RemoteStreamHandle
  answer(requestId: string, answer: RemotePromptAnswer): Promise<RemoteAnswerResult>
}

export interface RemoteService {
  $mount(contribution: unknown): Promise<() => Promise<void>>
  remotePrompt: PromptRemote
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | Promise<void> | undefined, label?: string): void
  /** Unguarded Cordis lookup, used for the namespace this plugin mounts itself. */
  get(name: string): unknown
  slots: SlotsService
  locale: LocaleService
  remote: RemoteService
}

/** The lazy argument reader the Harness gives a tool card. */
export interface ToolArgs {
  text(key: string): string | undefined
  value(key: string): unknown
  keys(): readonly string[]
  complete(key: string): boolean
}

export interface ContentBlock {
  type: string
  text?: string
}

export interface ToolCallBlock {
  args: ToolArgs
  content?: readonly ContentBlock[]
  isError?: boolean
  meta?: unknown
  /** Present on a start-phase block. */
  argsRaw?: string
  call?: { name: string; argsRaw: string } | null
}

export interface ToolCallProps {
  phase: "preparing" | "start" | "result"
  block: ToolCallBlock | Record<string, never>
  callId: string
  toolName: string
  cwd?: string
}

export interface PromptBridge {
  get(callId: string): RemotePromptRequest | undefined
  subscribe(listener: () => void): () => void
  answer(prompt: RemotePromptRequest, answer: RemotePromptAnswer): Promise<void>
  dispose(): void
}
