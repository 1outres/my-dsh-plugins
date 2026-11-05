import type { ContentBlock, ImageAttachmentRef, PromptContentPart } from "./types"

/** What the editor needs to know about one sent message. */
export interface MessageParts {
  /** The text blocks joined in order, as the shipped bubble shows them. */
  text: string
  images: ImageAttachmentRef[]
  /** Whether the message carries file attachments, which the browser cannot resend. */
  hasFiles: boolean
}

function isImageRef(value: unknown): value is ImageAttachmentRef {
  if (typeof value !== "object" || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref.attachmentId === "string" && typeof ref.mediaType === "string"
}

/**
 * Split a user message's durable content the way the shipped bubble does.
 * @param content - the message's content blocks.
 * @returns the text, the image references, and whether files are attached.
 */
export function messageParts(content: readonly ContentBlock[]): MessageParts {
  const texts: string[] = []
  const images: ImageAttachmentRef[] = []
  let hasFiles = false
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") texts.push(block.text)
    else if (block.type === "image" && isImageRef(block.attachment)) images.push(block.attachment)
    else if (block.type === "file") hasFiles = true
  }
  return { text: texts.join(""), images, hasFiles }
}

/**
 * Encode bytes as base64 without building one huge argument list.
 * @param bytes - raw attachment bytes.
 * @returns the base64 text.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** One image read back from the source Session, ready to send again. */
export interface LoadedImage {
  mediaType: string
  data: string
  name?: string
}

/**
 * Build the prompt for the edited message: the text first, then the images.
 * @param text - edited text.
 * @param images - images read back from the original message.
 * @returns prompt parts for `session.prompt`.
 */
export function promptContent(text: string, images: readonly LoadedImage[]): PromptContentPart[] {
  return [
    { type: "text", text },
    ...images.map(
      (image): PromptContentPart => ({
        type: "image",
        mediaType: image.mediaType,
        data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
      }),
    ),
  ]
}
