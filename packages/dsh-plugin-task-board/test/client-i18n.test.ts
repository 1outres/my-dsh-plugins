import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { en, ja } from "../src/client/i18n"

const clientDirectory = fileURLToPath(new URL("../src/client", import.meta.url))

function clientSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return clientSources(path)
    if (entry.name === "i18n.ts") return []
    return [readFileSync(path, "utf8")]
  })
}

describe("client dictionaries", () => {
  it("translate the same keys in en and ja", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
  })

  it("names the preset columns", () => {
    expect([en["column.todo"], en["column.in_progress"], en["column.done"]]).toEqual([
      "To do",
      "In progress",
      "Done",
    ])
    expect([ja["column.todo"], ja["column.in_progress"], ja["column.done"]]).toEqual([
      "未着手",
      "作業中",
      "完了",
    ])
  })

  it("writes セッション in Japanese copy", () => {
    expect(JSON.stringify(ja)).not.toMatch(/\bSession\b/)
    expect(ja.sessionButton).toContain("セッション")
  })

  it("keeps only keys the client uses", () => {
    const sources = clientSources(clientDirectory).join("\n")
    const unused = Object.keys(en).filter(
      (key) => !key.startsWith("column.") && !sources.includes(`"${key}"`),
    )
    expect(unused).toEqual([])
  })

  it("keeps English copy short", () => {
    const long = Object.entries(en).filter(([, text]) => text.split(" ").length > 8)
    expect(long).toEqual([])
  })
})
