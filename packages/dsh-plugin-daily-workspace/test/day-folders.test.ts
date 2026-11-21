import { describe, expect, it } from "vitest"
import { dayFolderOf } from "../src/shared/paths"

const ROOT = "/home/me/Documents"

describe("day folder paths", () => {
  it("matches a path that is exactly year, month, and day under the root", () => {
    expect(dayFolderOf("/home/me/Documents/2026/11/20", ROOT)).toEqual({
      year: "2026",
      month: "11",
      day: "20",
    })
    expect(dayFolderOf("/home/me/Documents/2026/11/20/", ROOT)).toEqual({
      year: "2026",
      month: "11",
      day: "20",
    })
    expect(dayFolderOf("/home/me/Documents/2026/11/20", "/home/me/Documents/")).toEqual({
      year: "2026",
      month: "11",
      day: "20",
    })
  })

  it("rejects anything that is not a year, month, and day folder", () => {
    for (const path of [
      "/home/me/Documents",
      "/home/me/Documents/2026",
      "/home/me/Documents/2026/11",
      "/home/me/Documents/2026/11/20/notes",
      "/home/me/Documents/project",
      "/home/me/Documents/2026/11/day",
      "/home/me/Documents/26/11/20",
      "/home/me/Documents/2026/1/20",
      "/home/me/Documents/2026/13/20",
      "/home/me/Documents/2026/11/32",
      "/home/me/Documents/2026/00/20",
      "/home/me/Documents/2026/11/00",
      "/home/me/Documents2/2026/11/20",
      "/home/me",
    ]) {
      expect(dayFolderOf(path, ROOT), path).toBeUndefined()
    }
    expect(dayFolderOf(undefined, ROOT)).toBeUndefined()
  })

  it("ignores a day folder under another root", () => {
    expect(dayFolderOf("/srv/docs/2026/11/20", ROOT)).toBeUndefined()
  })

  it("works with a filesystem root", () => {
    expect(dayFolderOf("/2026/11/20", "/")).toEqual({ year: "2026", month: "11", day: "20" })
  })

  it("keeps the Windows separator", () => {
    expect(
      dayFolderOf("C:\\Users\\me\\Documents\\2026\\11\\20", "C:\\Users\\me\\Documents"),
    ).toEqual({
      year: "2026",
      month: "11",
      day: "20",
    })
    expect(
      dayFolderOf("C:\\Users\\me\\Documents/2026/11/20", "C:\\Users\\me\\Documents"),
    ).toBeUndefined()
  })
})
