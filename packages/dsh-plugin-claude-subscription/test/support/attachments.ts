import { AttachmentId, type ImageAttachmentRef } from "@deepseek-ai/dsh-attachment"
import type { ImageBlock } from "@deepseek-ai/dsh-llm"
import type { AttachmentReader } from "../../src/request/prepare"

export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function imageRef(overrides: Partial<ImageAttachmentRef> = {}): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${"ab".repeat(32)}`),
    mediaType: "image/png",
    bytes: PNG_BYTES.length,
    width: 640,
    height: 480,
    ...overrides,
  }
}

export function imageBlock(ref: ImageAttachmentRef, offloaded = false): ImageBlock {
  return { type: "image", attachment: ref, ...(offloaded ? { offloaded: true as const } : {}) }
}

/** A reader whose every image has the given number of bytes. */
export function sizedReader(bytes: number): AttachmentReader {
  return {
    readImageRequest: async () => ({
      data: new Uint8Array(bytes),
      mediaType: "image/png",
      width: 320,
      height: 240,
    }),
  }
}

export interface RecordingReader extends AttachmentReader {
  calls: Parameters<AttachmentReader["readImageRequest"]>[]
}

export function recordingReader(width = 320, height = 240): RecordingReader {
  const calls: RecordingReader["calls"] = []
  return {
    calls,
    async readImageRequest(ref, target, signal) {
      calls.push([ref, target, signal])
      return { data: PNG_BYTES, mediaType: "image/png", width, height }
    },
  }
}
