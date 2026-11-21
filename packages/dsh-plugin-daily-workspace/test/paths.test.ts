import { describe, expect, it } from "vitest"
import { dailyPaths, localDateKey, msUntilNextLocalDay } from "../src/host/paths"
import {
  DEFAULT_ROOT,
  expandHome,
  isAbsolutePath,
  joinPath,
  resolveRoot,
} from "../src/shared/paths"

describe("root resolution", () => {
  it("expands a leading ~ against the Host home and drops trailing slashes", () => {
    expect(expandHome("~/Documents/", "/home/me")).toBe("/home/me/Documents")
    expect(expandHome("~", "/home/me/")).toBe("/home/me")
    expect(expandHome("/srv/docs//", "/home/me")).toBe("/srv/docs")
  })

  it("cannot expand ~ before the home is known", () => {
    expect(expandHome("~/docs", undefined)).toBeUndefined()
    expect(expandHome("~/docs", "")).toBeUndefined()
    expect(resolveRoot("~/docs", undefined)).toBeUndefined()
  })

  it("defaults to ~/Documents and rejects a relative root", () => {
    expect(DEFAULT_ROOT).toBe("~/Documents")
    expect(resolveRoot(undefined, "/home/me")).toBe("/home/me/Documents")
    expect(resolveRoot("  ", "/home/me")).toBe("/home/me/Documents")
    expect(resolveRoot("Documents", "/home/me")).toBeUndefined()
    expect(resolveRoot("/srv/docs", undefined)).toBe("/srv/docs")
  })

  it("tells absolute paths from relative ones", () => {
    expect(isAbsolutePath("/srv/docs")).toBe(true)
    expect(isAbsolutePath("C:\\docs")).toBe(true)
    expect(isAbsolutePath("docs")).toBe(false)
    expect(isAbsolutePath("./docs")).toBe(false)
  })
})

describe("daily paths", () => {
  it("joins one child onto a directory", () => {
    expect(joinPath("/a/b/", "c")).toBe("/a/b/c")
    expect(joinPath("/", "c")).toBe("/c")
    expect(joinPath("C:\\Users\\me", "x")).toBe("C:\\Users\\me\\x")
  })

  it("puts the local day under a zero-padded year and month", () => {
    expect(dailyPaths("/home/me/Documents", new Date(2026, 0, 5, 9))).toEqual({
      year: "/home/me/Documents/2026",
      month: "/home/me/Documents/2026/01",
      day: "/home/me/Documents/2026/01/05",
    })
    expect(dailyPaths("/docs", new Date(2026, 10, 20, 23, 59))).toEqual({
      year: "/docs/2026",
      month: "/docs/2026/11",
      day: "/docs/2026/11/20",
    })
  })
})

describe("local date key", () => {
  it("keys a moment by its local date", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(localDateKey(new Date(2026, 10, 20, 0, 0))).toBe("2026-11-20")
  })
})

describe("next local midnight", () => {
  it("measures from the moment to the start of the next local day", () => {
    const noon = new Date(2026, 10, 20, 12, 0, 0)
    expect(msUntilNextLocalDay(noon)).toBe(new Date(2026, 10, 21).getTime() - noon.getTime())
  })

  it("keeps the one millisecond left just before midnight", () => {
    const last = new Date(2026, 10, 20, 23, 59, 59, 999)
    expect(msUntilNextLocalDay(last)).toBe(1)
  })

  it("rolls over a month and a year boundary", () => {
    const newYear = new Date(2026, 11, 31, 23, 0, 0)
    expect(msUntilNextLocalDay(newYear)).toBe(new Date(2027, 0, 1).getTime() - newYear.getTime())
  })
})
