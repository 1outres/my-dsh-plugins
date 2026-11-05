import type {
  ImageAttachmentRef,
  ImageMediaType,
  ImageRequestTarget,
  RequestImageAttachment,
} from "@deepseek-ai/dsh-attachment"
import type { ImageBlock, RequestMessage } from "@deepseek-ai/dsh-llm"
import { FailureCode, NativeFailure } from "../errors"

const MAX_REQUEST_IMAGE_PIXELS = 2048 * 2048
const MAX_REQUEST_IMAGE_BYTES = 1024 * 1024
const MAX_REQUEST_IMAGES_BASE64_BYTES = 20 * 1024 * 1024

const EXTENSIONS: Readonly<Record<ImageMediaType, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
}

/** Where tools can open the normalized copy of an image, read-only. */
export interface ImageAccess {
  readonly readonlyPath: string
}

export type ImageVersion = Pick<RequestImageAttachment, "data" | "mediaType" | "width" | "height">

/** The part of DSH's attachment service that request assembly needs. */
export interface AttachmentReader {
  readImageRequest(
    ref: ImageAttachmentRef,
    target: ImageRequestTarget,
    signal?: AbortSignal,
  ): Promise<ImageVersion>
}

/** Images of a request by attachment id. */
export type RequestImages = ReadonlyMap<string, ImageVersion>

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(MAX_REQUEST_IMAGE_PIXELS / (width * height)))
  if (scale === 1) return { width, height }
  const longSide = Math.max(width, height)
  const shortSide = Math.min(width, height)
  let long = Math.max(1, Math.floor(longSide * scale))
  let short = Math.max(1, Math.round((long * shortSide) / longSide))
  while (long * short > MAX_REQUEST_IMAGE_PIXELS && long > 1) {
    long -= 1
    short = Math.max(1, Math.round((long * shortSide) / longSide))
  }
  return width >= height ? { width: long, height: short } : { width: short, height: long }
}

/** The size and byte limit asked of the attachment service for one image. */
export function imageRequestTarget(ref: ImageAttachmentRef): ImageRequestTarget {
  return { ...scaledDimensions(ref.width, ref.height), maxBytes: MAX_REQUEST_IMAGE_BYTES }
}

function imageIdentity(ref: ImageAttachmentRef): string {
  return ref.name === undefined
    ? String(ref.attachmentId)
    : `${JSON.stringify(ref.name)} (${ref.attachmentId})`
}

function accessText(ref: ImageAttachmentRef, access: ImageAccess): string {
  return (
    ` Normalized copy (read-only; may be resized or re-encoded): ${JSON.stringify(access.readonlyPath)} ` +
    `(${ref.width}x${ref.height}px, ${ref.mediaType}). ` +
    "Source dimensions, format, and byte size may differ. " +
    `Copy to a writable path ending in ${EXTENSIONS[ref.mediaType]} before editing.`
  )
}

/** Text that names an image to the model, in the words DSH uses for other routes. */
export function imageHandleText(
  ref: ImageAttachmentRef,
  version: Pick<ImageVersion, "width" | "height">,
  access: ImageAccess | undefined,
): string {
  const preview = `Image ${imageIdentity(ref)}; request preview ${version.width}x${version.height}px.`
  if (access !== undefined) return preview + accessText(ref, access)
  return `${preview} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`
}

/** Text sent in place of an image that DSH dropped to fit the request limits. */
export function offloadedImageText(
  ref: ImageAttachmentRef,
  access: ImageAccess | undefined,
): string {
  const identity = `image omitted to fit request image limits; ${imageIdentity(ref)}.`
  if (access !== undefined) return `[${identity}${accessText(ref, access)}]`
  return `[${identity} No local normalized image path is available; ask the user to attach it again if needed.]`
}

/** The request version that `readRequestImages` read for a retained image. */
export function requestVersionOf(block: ImageBlock, images: RequestImages): ImageVersion {
  const version = images.get(String(block.attachment.attachmentId))
  if (version === undefined) {
    throw new NativeFailure("An image of the request was not read", FailureCode.invalidRequest)
  }
  return version
}

function imageBlocksOf(message: RequestMessage): ImageBlock[] {
  return message.content.filter((block): block is ImageBlock => block.type === "image")
}

function retainedImageBlocks(messages: readonly RequestMessage[]): ImageBlock[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "tool")
    .flatMap(imageBlocksOf)
    .filter((block) => block.offloaded !== true)
}

/**
 * Reads the request version of every image the model will see. A request with an image
 * needs the attachment service, because the placeholder for a dropped image names it too.
 */
export async function readRequestImages(
  messages: readonly RequestMessage[],
  reader: AttachmentReader | undefined,
  signal: AbortSignal | undefined,
): Promise<RequestImages> {
  const blocks = messages.flatMap(imageBlocksOf)
  if (blocks.length === 0) return new Map()
  if (reader === undefined) {
    throw new NativeFailure(
      "Images need the attachment service, which is not available",
      FailureCode.invalidRequest,
    )
  }
  const refs = new Map<string, ImageAttachmentRef>()
  for (const block of retainedImageBlocks(messages)) {
    refs.set(String(block.attachment.attachmentId), block.attachment)
  }
  const entries = await Promise.all(
    [...refs].map(async ([id, ref]) => {
      const version = await reader.readImageRequest(ref, imageRequestTarget(ref), signal)
      return [id, version] as const
    }),
  )
  return new Map(entries)
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** How many of the oldest retained images must go before the request fits. Zero when it fits. */
function requiredImageOffload(messages: readonly RequestMessage[], images: RequestImages): number {
  const lengths = retainedImageBlocks(messages).map((block) =>
    base64Length(requestVersionOf(block, images).data.byteLength),
  )
  const excess = lengths.reduce((sum, length) => sum + length, 0) - MAX_REQUEST_IMAGES_BASE64_BYTES
  if (excess <= 0) return 0
  let removed = 0
  let count = 0
  for (const length of lengths) {
    if (removed >= excess) break
    removed += length
    count += 1
  }
  return count
}

/**
 * DSH offloads the oldest images itself when a route fails with `IMAGE_OFFLOAD_REQUIRED`, so the
 * request is refused here until it fits the byte budget that DSH's own adapters use.
 */
export function assertImagesFit(messages: readonly RequestMessage[], images: RequestImages): void {
  const offloadImages = requiredImageOffload(messages, images)
  if (offloadImages === 0) return
  throw new NativeFailure(
    `Request images exceed the ${MAX_REQUEST_IMAGES_BASE64_BYTES}-byte base64 bound; ` +
      `${offloadImages} more oldest occurrence(s) must be offloaded.`,
    FailureCode.imageOffloadRequired,
    { offloadImages },
  )
}
