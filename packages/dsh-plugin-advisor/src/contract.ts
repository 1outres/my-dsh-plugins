import type {
  FileBlock,
  GenerateOptions,
  Message,
  StreamChunk,
  ToolSchema,
} from "@deepseek-ai/dsh-llm"
import type { SessionId } from "@deepseek-ai/dsh-session"

declare module "@deepseek-ai/dsh-llm" {
  interface LlmRequestPurposeMap {
    advisor: true
  }
}

export type FileAttachmentRef = FileBlock["attachment"]

export interface VolatileValue<T> {
  get(): T
}

export interface AdvisorConfig {
  readonly provider: VolatileValue<string>
  readonly model: VolatileValue<string>
  readonly reasoningEffort: VolatileValue<string>
  readonly adviceWordLimit: VolatileValue<number>
  readonly timeoutMs: VolatileValue<number>
}

export interface AdvisorRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface AdvisorSettings {
  readonly route: AdvisorRoute
  readonly adviceWordLimit: number
  readonly timeoutMs: number
}

export type AdvisorErrorCode =
  | "invalid_config"
  | "too_many_requests"
  | "overloaded"
  | "prompt_too_long"
  | "execution_time_exceeded"
  | "model_not_found"
  | "unavailable"

export interface ExecutorRecords {
  readonly tools: readonly ToolSchema[]
  readonly messages: readonly Message[]
}

export interface RenderOptions {
  readonly nested: boolean
  readonly fileText: (ref: FileAttachmentRef) => string
}

export interface AdviceRequest {
  readonly settings: AdvisorSettings
  readonly records: ExecutorRecords
  readonly nested: boolean
  readonly sessionId: SessionId
  readonly signal: AbortSignal
}

export interface Advice {
  readonly advice: string
  readonly model: string
  readonly truncated: boolean
}

export interface AdvisorPorts {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  fileText(ref: FileAttachmentRef): string
}
