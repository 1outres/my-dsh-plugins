import { describe, expect, it } from "vitest"
import { bytesToBase64, messageParts, promptContent } from "../src/client/content"

describe("messageParts", () => {
  it("joins text blocks and collects images like the shipped bubble", () => {
    const image = { attachmentId: "a1", mediaType: "image/png", bytes: 3, width: 1, height: 1 }
    expect(
      messageParts([
        { type: "text", text: "Hello " },
        { type: "image", attachment: image },
        { type: "text", text: "world" },
      ]),
    ).toEqual({ text: "Hello world", images: [image], hasFiles: false })
  })

  it("flags file attachments and ignores malformed blocks", () => {
    const parts = messageParts([
      { type: "text", text: "see file" },
      { type: "file", attachment: { attachmentId: "f1", name: "a.txt", bytes: 1 } },
      { type: "image", attachment: { attachmentId: 7 } },
      { type: "text", text: 42 },
    ])
    expect(parts).toEqual({ text: "see file", images: [], hasFiles: true })
  })
})

describe("bytesToBase64", () => {
  it("encodes bytes, including inputs longer than one chunk", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=")
    const large = new Uint8Array(0x8000 * 2 + 5).fill(65)
    expect(bytesToBase64(large)).toBe(Buffer.from(large).toString("base64"))
  })
})

describe("promptContent", () => {
  it("sends the text first, then each image with its name when known", () => {
    expect(
      promptContent("edited", [
        { mediaType: "image/png", data: "AAA", name: "shot.png" },
        { mediaType: "image/jpeg", data: "BBB" },
      ]),
    ).toEqual([
      { type: "text", text: "edited" },
      { type: "image", mediaType: "image/png", data: "AAA", name: "shot.png" },
      { type: "image", mediaType: "image/jpeg", data: "BBB" },
    ])
  })
})
