import { describe, expect, it } from "vitest"
import { en, ja } from "../src/client/i18n"

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
})
