import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { en, ja, zh } from "../src/client/i18n"

function load(language: string): Record<string, unknown> {
  const url = new URL(`../locale/${language}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>
}

function runtimeKeysOf(language: string): Record<string, unknown> {
  const { meta: _meta, ...runtime } = load(language)
  return runtime
}

describe("locale files", () => {
  it("name the plugin and describe it in en and ja", () => {
    expect(load("en").meta).toMatchObject({ title: "Remote hosts" })
    expect(load("ja").meta).toMatchObject({ title: "リモート接続" })
  })

  it("match the dictionaries the browser half registers", () => {
    expect(runtimeKeysOf("en")).toEqual(en)
    expect(runtimeKeysOf("ja")).toEqual(ja)
    expect(runtimeKeysOf("zh")).toEqual(zh)
  })

  it("translate the same keys in every language", () => {
    const keys = Object.keys(en).sort()
    expect(Object.keys(ja).sort()).toEqual(keys)
    expect(Object.keys(zh).sort()).toEqual(keys)
  })
})
