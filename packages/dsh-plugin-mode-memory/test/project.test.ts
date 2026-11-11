import { describe, expect, it } from "vitest"
import { normalizeProject } from "../src/host/project"

describe("normalizeProject", () => {
  it("keeps a plain directory path", () => {
    expect(normalizeProject("/home/me/project")).toBe("/home/me/project")
    expect(normalizeProject("C:\\work\\project")).toBe("C:\\work\\project")
  })

  it("strips trailing separators", () => {
    expect(normalizeProject("/home/me/project/")).toBe("/home/me/project")
    expect(normalizeProject("/home/me/project///")).toBe("/home/me/project")
    expect(normalizeProject("C:\\work\\project\\")).toBe("C:\\work\\project")
    expect(normalizeProject("C:\\work\\project\\\\")).toBe("C:\\work\\project")
  })

  it("keeps a root path", () => {
    expect(normalizeProject("/")).toBe("/")
    expect(normalizeProject("//")).toBe("//")
    expect(normalizeProject("\\")).toBe("\\")
    expect(normalizeProject("C:\\")).toBe("C:\\")
  })

  it("treats an empty path as no project", () => {
    expect(normalizeProject("")).toBeUndefined()
  })
})
