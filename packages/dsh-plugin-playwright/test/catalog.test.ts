import { describe, expect, test } from "vitest"
import { EXCLUDED_TOOLS, selectTools, type UpstreamTool } from "../src/host/catalog"

function tool(name: string): UpstreamTool {
  return {
    name,
    title: name,
    description: name,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: false,
    taskRequired: false,
  }
}

describe("selectTools", () => {
  test("keeps upstream order and drops the tools that cannot be isolated", () => {
    const selected = selectTools([
      tool("browser_navigate"),
      tool("browser_close"),
      tool("browser_snapshot"),
      tool("browser_run_code_unsafe"),
      tool("browser_install"),
      tool("browser_tabs"),
    ])
    expect(selected.map((item) => item.name)).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_tabs",
    ])
    expect([...EXCLUDED_TOOLS].sort()).toEqual([
      "browser_close",
      "browser_install",
      "browser_run_code_unsafe",
    ])
  })

  test("refuses a duplicate upstream name", () => {
    expect(() => selectTools([tool("browser_navigate"), tool("browser_navigate")])).toThrow(
      /listed tool "browser_navigate" more than once/,
    )
  })
})
