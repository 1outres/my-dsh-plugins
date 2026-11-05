import { describe, expect, it } from "vitest"
import {
  DEFAULT_ROOT,
  expandHome,
  isRootPath,
  joinPath,
  resolveRoot,
  scratchName,
  scratchNameOf,
  splitPath,
  uniqueName,
} from "../src/shared/paths"

describe("root resolution", () => {
  it("expands ~ against the Host home and drops trailing slashes", () => {
    expect(expandHome("~/.dsh/scratchpad/", "/home/me")).toBe("/home/me/.dsh/scratchpad")
    expect(expandHome("~", "/home/me/")).toBe("/home/me")
    expect(expandHome("/srv/scratch//", "/home/me")).toBe("/srv/scratch")
  })

  it("cannot expand ~ before the home is known", () => {
    expect(expandHome("~/x", undefined)).toBeUndefined()
    expect(resolveRoot("~/x", undefined)).toBeUndefined()
  })

  it("defaults to ~/.dsh/scratchpad and rejects relative roots", () => {
    expect(DEFAULT_ROOT).toBe("~/.dsh/scratchpad")
    expect(resolveRoot(undefined, "/home/me")).toBe("/home/me/.dsh/scratchpad")
    expect(resolveRoot("  ", "/home/me")).toBe("/home/me/.dsh/scratchpad")
    expect(resolveRoot("scratch", "/home/me")).toBeUndefined()
    expect(resolveRoot("/tmp/s", undefined)).toBe("/tmp/s")
  })
})

describe("scratch paths", () => {
  it("joins and splits POSIX paths", () => {
    expect(joinPath("/a/b/", "c")).toBe("/a/b/c")
    expect(splitPath("/a/b/c")).toEqual({ parent: "/a/b", name: "c" })
    expect(splitPath("/c")).toEqual({ parent: "/", name: "c" })
  })

  it("keeps Windows separators under a Windows root", () => {
    expect(joinPath("C:\\Users\\me\\scratch", "x")).toBe("C:\\Users\\me\\scratch\\x")
    expect(splitPath("C:\\Users\\me\\scratch\\x")).toEqual({
      parent: "C:\\Users\\me\\scratch",
      name: "x",
    })
  })

  it("names only visible directories directly under a root", () => {
    const roots = ["/home/me/.dsh/scratchpad", "/data/scratchpad"]
    expect(scratchNameOf("/home/me/.dsh/scratchpad/2026-11-05-231336", roots)).toBe(
      "2026-11-05-231336",
    )
    expect(scratchNameOf("/data/scratchpad/x/", roots)).toBe("x")
    expect(scratchNameOf("/home/me/.dsh/scratchpad", roots)).toBeUndefined()
    expect(scratchNameOf("/home/me/.dsh/scratchpad/.archived", roots)).toBeUndefined()
    expect(scratchNameOf("/home/me/.dsh/scratchpad/.archived/x", roots)).toBeUndefined()
    expect(scratchNameOf("/home/me/.dsh/scratchpad/x/y", roots)).toBeUndefined()
    expect(scratchNameOf(undefined, roots)).toBeUndefined()
  })

  it("recognizes the root itself", () => {
    expect(isRootPath("/r/", ["/r"])).toBe(true)
    expect(isRootPath("/r/x", ["/r"])).toBe(false)
    expect(isRootPath(undefined, ["/r"])).toBe(false)
  })
})

describe("scratch names", () => {
  it("formats the local time as YYYY-MM-DD-HHmmss", () => {
    expect(scratchName(new Date(2026, 10, 5, 23, 13, 6))).toBe("2026-11-05-231306")
    expect(scratchName(new Date(2027, 0, 1, 0, 0, 0))).toBe("2027-01-01-000000")
  })

  it("adds -2, -3, ... only on a collision", () => {
    expect(uniqueName("a", () => false)).toBe("a")
    const taken = new Set(["a", "a-2"])
    expect(uniqueName("a", (name) => taken.has(name))).toBe("a-3")
  })
})
