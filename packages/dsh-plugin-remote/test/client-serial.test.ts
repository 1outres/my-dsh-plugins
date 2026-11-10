import { describe, expect, it } from "vitest"
import { en, ja, zh } from "../src/client/i18n"
import { lineEndingLabelKey } from "../src/client/serial"
import type { SerialLineEnding } from "../src/shared/types"

const dictionaries: Record<string, Record<string, string>> = { en, ja, zh }
const lineEndings: SerialLineEnding[] = ["cr", "lf", "crlf"]

describe("line ending labels", () => {
  it("maps each line ending to its own translation key", () => {
    expect(lineEndingLabelKey("cr")).toBe("lineEnding.cr")
    expect(lineEndingLabelKey("lf")).toBe("lineEnding.lf")
    expect(lineEndingLabelKey("crlf")).toBe("lineEnding.crlf")
  })

  it("names every line ending in every language", () => {
    for (const [language, dictionary] of Object.entries(dictionaries)) {
      for (const lineEnding of lineEndings) {
        expect(dictionary[lineEndingLabelKey(lineEnding)], language).toEqual(expect.any(String))
      }
    }
  })
})
