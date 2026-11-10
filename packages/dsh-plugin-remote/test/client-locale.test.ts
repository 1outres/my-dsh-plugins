import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { en, ja, zh } from "../src/client/i18n"

function load(language: string): Record<string, string> {
  const url = new URL(`../locale/${language}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, string>
}

describe("locale files", () => {
  it("match the dictionaries the browser half registers", () => {
    expect(load("en")).toEqual(en)
    expect(load("ja")).toEqual(ja)
    expect(load("zh")).toEqual(zh)
  })

  it("translate the same keys in every language", () => {
    const keys = Object.keys(en).sort()
    expect(Object.keys(ja).sort()).toEqual(keys)
    expect(Object.keys(zh).sort()).toEqual(keys)
  })
})
