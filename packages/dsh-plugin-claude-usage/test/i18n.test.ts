import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { en, ja } from "../src/client/i18n"

interface DisplayMeta {
  meta: { title: string; description: string }
}

function load(language: string): DisplayMeta {
  const url = new URL(`../locale/${language}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, "utf8")) as DisplayMeta
}

describe("display locale files", () => {
  it("name the plugin and describe it in every language", () => {
    expect(load("en").meta.title).toBe("Claude usage")
    expect(load("en").meta.description).toContain("Claude subscription usage")
    expect(load("ja").meta.title).toBe("Claude の使用量")
    expect(load("ja").meta.description).toContain("使用量")
  })

  it("translate the same runtime keys in every language", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
  })
})
