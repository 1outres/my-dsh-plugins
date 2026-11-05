import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment"
import type { GenerateOptions, RequestMessage } from "@deepseek-ai/dsh-llm"
import { nativeModel } from "../catalog"
import type { NativeFrame, PreparedRequest } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { generationOf } from "./generation"
import { framesOf } from "./history"
import {
  type AttachmentReader,
  assertImagesFit,
  type ImageAccess,
  readRequestImages,
} from "./images"
import { conversationSessionId } from "./session-id"
import { declareTools } from "./tools"

export type { AttachmentReader } from "./images"

export interface PrepareDeps {
  /** The attachment service, when DSH has one. Read on every call. */
  attachments: () => AttachmentReader | undefined
  /** The read-only path of an image's normalized copy, when the host can map one. */
  imageAccess: (ref: ImageAttachmentRef) => ImageAccess | undefined
}

function invalid(message: string): NativeFailure {
  return new NativeFailure(message, FailureCode.invalidRequest)
}

function systemText(message: RequestMessage): string {
  return message.content
    .map((block) => {
      if (block.type !== "text") throw invalid("System messages must contain text only")
      return block.text
    })
    .join("")
}

function splitSystemPrompt(options: GenerateOptions): {
  system: string
  history: RequestMessage[]
} {
  const texts = [options.system]
  let end = 0
  for (const message of options.messages) {
    if (message.role !== "system") break
    texts.push(systemText(message))
    end += 1
  }
  return {
    system: texts.filter((text) => text !== undefined && text !== "").join("\n\n"),
    history: options.messages.slice(end),
  }
}

function assertEndsWithUserTurn(frames: readonly NativeFrame[]): void {
  const last = frames.at(-1)
  if (last?.type !== "user" || last.message.content.length === 0) {
    throw invalid("History must end in a nonempty user or tool-result message")
  }
}

/** Translates one DSH model call into what the CLI needs. It does no I/O except reading images. */
export async function prepareRequest(
  options: GenerateOptions,
  deps: PrepareDeps,
): Promise<PreparedRequest> {
  if (options.model === "") throw invalid("A model is required")
  const model = nativeModel(options.model)
  const generation = generationOf(options)
  const { system, history } = splitSystemPrompt(options)
  const declarations = declareTools(options.tools ?? [])
  const images = await readRequestImages(history, deps.attachments(), options.signal)
  assertImagesFit(history, images)
  const frames = framesOf(history, {
    nativeModel: model,
    toolNames: declarations.names,
    images,
    imageAccess: deps.imageAccess,
  })
  assertEndsWithUserTurn(frames)
  return {
    nativeModel: model,
    system,
    frames,
    extraBody: { ...generation.body, tools: declarations.wire },
    ...(generation.effort === undefined ? {} : { effort: generation.effort }),
    ...(generation.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: generation.maxOutputTokens }),
    manifest: declarations.manifest,
    toolNames: declarations.names,
    sessionId: conversationSessionId(system, frames),
    oneShot:
      options.purpose !== undefined && declarations.manifest.length === 0 && frames.length === 1,
  }
}
