import { existsSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PreparedRequest } from "../../src/contract"
import { removeRequestFiles, writeRequestFiles } from "../../src/native/request-files"

const made: string[] = []
const failing = { path: "" }

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    mkdtemp: vi.fn(async (...args: Parameters<typeof actual.mkdtemp>) => {
      const directory = await actual.mkdtemp(...args)
      made.push(directory)
      return directory
    }),
    writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
      if (failing.path !== "" && String(args[0]).endsWith(failing.path))
        throw new Error("disk full")
      return actual.writeFile(...args)
    }),
  }
})

const REQUEST = {
  system: "be brief",
  extraBody: { max_tokens: 10 },
  manifest: [{ name: "probe", description: "", inputSchema: { type: "object" } }],
} as unknown as PreparedRequest

describe("writeRequestFiles", () => {
  afterEach(() => {
    failing.path = ""
    made.length = 0
  })

  it("writes the system prompt, the settings and the tool manifest", async () => {
    const files = await writeRequestFiles(REQUEST)
    try {
      expect(await readFile(files.system, "utf8")).toBe("be brief")
      expect(JSON.parse(await readFile(files.settings, "utf8"))).toEqual({
        env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(REQUEST.extraBody) },
      })
      expect(JSON.parse(await readFile(files.tools, "utf8"))).toEqual(REQUEST.manifest)
    } finally {
      await removeRequestFiles(files)
    }
    expect(existsSync(files.directory)).toBe(false)
  })

  it.each(["system.md", "settings.json", "tools.json"])(
    "removes the directory and rethrows when the write of %s fails",
    async (file) => {
      failing.path = file
      await expect(writeRequestFiles(REQUEST)).rejects.toThrow("disk full")
      expect(made).toHaveLength(1)
      expect(existsSync(made[0] as string)).toBe(false)
    },
  )

  it("still creates nothing to clean up when the directory cannot be made", async () => {
    vi.mocked(mkdtemp).mockRejectedValueOnce(new Error("no space"))
    await expect(writeRequestFiles(REQUEST)).rejects.toThrow("no space")
    expect(made).toEqual([])
  })
})
