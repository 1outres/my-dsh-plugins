import { requestImageDimensions } from "@deepseek-ai/dsh-attachment"
import { offloadedImageText, requestImageHandleText } from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import {
  type ImageAccess,
  imageHandleText,
  imageRequestTarget,
  offloadedImageText as offloaded,
} from "../../src/request/images"
import { imageRef } from "../support/attachments"

const BUDGET = 2048 * 2048

describe("imageRequestTarget", () => {
  it.each([
    [640, 480],
    [2048, 2048],
    [4000, 3000],
    [3000, 4000],
    [9000, 700],
    [700, 9000],
    [1, 5000],
    [8192, 8192],
  ])("scales %ix%i the way DSH does", (width, height) => {
    const target = imageRequestTarget(imageRef({ width, height }))
    const expected = requestImageDimensions(width, height, BUDGET)
    expect({ width: target.width, height: target.height }).toEqual(expected)
    expect(target.maxBytes).toBe(1024 * 1024)
  })
})

describe("image text", () => {
  const version = { width: 10, height: 20 }
  const access: ImageAccess = { readonlyPath: '/work/.dsh/attachments/"odd" name.png' }

  it.each([undefined, "shot.png"])("matches the text DSH shows other routes (name %s)", (name) => {
    const ref = imageRef(name === undefined ? {} : { name })
    expect(imageHandleText(ref, version as never, undefined)).toBe(
      requestImageHandleText(ref, version),
    )
    expect(offloaded(ref, undefined)).toBe(offloadedImageText(ref))
  })

  it.each([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
    ["image/gif", ".gif"],
  ] as const)("names the read-only path of a %s image the way DSH does", (mediaType, extension) => {
    const ref = imageRef({ mediaType, name: "shot" })
    const handle = imageHandleText(ref, version as never, access)
    expect(handle).toBe(requestImageHandleText(ref, version, access))
    expect(handle).toContain(JSON.stringify(access.readonlyPath))
    expect(handle).toContain(extension)
    expect(offloaded(ref, access)).toBe(offloadedImageText(ref, access))
  })
})
