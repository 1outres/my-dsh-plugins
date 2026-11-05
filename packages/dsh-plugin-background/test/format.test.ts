import { describe, expect, it } from "vitest"
import {
  alphaColor,
  clamp,
  dimColor,
  imageCssValue,
  isAbsolutePath,
  isRemoteUrl,
  resolveImageSource,
} from "../src/client/format"

describe("resolveImageSource", () => {
  const base = "https://dsh.example/"

  it("keeps https URLs", () => {
    expect(resolveImageSource("https://cdn.example/bg.jpg", base)).toBe(
      "https://cdn.example/bg.jpg",
    )
  })

  it("keeps http URLs", () => {
    expect(resolveImageSource("http://cdn.example/bg.jpg", base)).toBe("http://cdn.example/bg.jpg")
  })

  it("maps absolute paths onto the authenticated file route", () => {
    expect(resolveImageSource("/home/me/My Wallpaper.png", base)).toBe(
      "https://dsh.example/api/file?path=%2Fhome%2Fme%2FMy%20Wallpaper.png",
    )
  })

  it("resolves the file route against a nested base", () => {
    expect(resolveImageSource("/tmp/bg.png", "https://dsh.example/app/")).toBe(
      "https://dsh.example/app/api/file?path=%2Ftmp%2Fbg.png",
    )
  })

  it("rejects relative paths", () => {
    expect(resolveImageSource("./bg.png", base)).toBeUndefined()
    expect(resolveImageSource("bg.png", base)).toBeUndefined()
  })

  it("rejects empty and non-http schemes", () => {
    expect(resolveImageSource("   ", base)).toBeUndefined()
    expect(resolveImageSource("file:///tmp/bg.png", base)).toBeUndefined()
    expect(resolveImageSource("javascript:alert(1)", base)).toBeUndefined()
  })

  it("accepts Windows absolute paths", () => {
    expect(resolveImageSource("C:\\Users\\me\\bg.png", base)).toBe(
      "https://dsh.example/api/file?path=C%3A%5CUsers%5Cme%5Cbg.png",
    )
  })
})

describe("isRemoteUrl and isAbsolutePath", () => {
  it("detects the forms the resolver accepts", () => {
    expect(isRemoteUrl("HTTPS://example.com/x")).toBe(true)
    expect(isRemoteUrl("/tmp/x")).toBe(false)
    expect(isAbsolutePath("/tmp/x")).toBe(true)
    expect(isAbsolutePath("C:/tmp/x")).toBe(true)
    expect(isAbsolutePath("tmp/x")).toBe(false)
  })
})

describe("alphaColor", () => {
  it("returns the input unchanged at 100 percent", () => {
    expect(alphaColor("#fff", 100)).toBe("#fff")
    expect(alphaColor("#fff", 120)).toBe("#fff")
  })

  it("wraps the color in color-mix", () => {
    expect(alphaColor("#fff", 70)).toBe("color-mix(in srgb, #fff 70%, transparent)")
    expect(alphaColor("rgb(1, 2, 3)", 0)).toBe("color-mix(in srgb, rgb(1, 2, 3) 0%, transparent)")
  })

  it("clamps out-of-range values", () => {
    expect(alphaColor("#fff", -5)).toBe("color-mix(in srgb, #fff 0%, transparent)")
  })
})

describe("dimColor", () => {
  it("converts a percentage to an rgba veil", () => {
    expect(dimColor(30)).toBe("rgba(0, 0, 0, 0.3)")
    expect(dimColor(0)).toBe("rgba(0, 0, 0, 0)")
    expect(dimColor(100)).toBe("rgba(0, 0, 0, 1)")
  })
})

describe("imageCssValue", () => {
  it("quotes the URL so the CSS value cannot break out", () => {
    expect(imageCssValue("https://x.test/a.png")).toBe('url("https://x.test/a.png")')
    expect(imageCssValue('https://x.test/").png')).toBe('url("https://x.test/\\").png")')
  })
})

describe("clamp", () => {
  it("clamps and rejects non-finite input", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(Number.NaN, 0, 10)).toBe(0)
  })
})
