import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { TB_CSS } from "../src/client/styles"

const clientDirectory = fileURLToPath(new URL("../src/client", import.meta.url))

const ALLOWED_TOKENS = new Set([
  "--dsw-alias-bg-base",
  "--dsw-alias-bg-layer-1",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-overlay",
  "--dsw-alias-bg-module-platform",
  "--dsw-specific-sidebar-fill",
  "--dsw-specific-menu",
  "--dsw-menu-backdrop-filter",
  "--dsw-elevation-prominent",
  "--dsw-elevation-stroke-color",
  "--dsw-alias-border-l1",
  "--dsw-alias-border-l2",
  "--dsw-alias-border-l3",
  "--dsw-alias-border-l4",
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-caption",
  "--dsw-alias-label-primary-foreground",
  "--dsw-alias-state-business-primary",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-interactive-bg-hover-danger",
  "--dsw-radius-sm",
  "--dsw-radius-md",
  "--dsw-radius-lg",
  "--dsw-focus-ring-color",
])

function sources(directory: string): { path: string; text: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return [{ path: relative(clientDirectory, path), text: readFileSync(path, "utf8") }]
  })
}

describe("client stylesheet", () => {
  it("uses only the host theme tokens", () => {
    const tokens = [...TB_CSS.matchAll(/--dsw-[a-z0-9-]+/g)].map((match) => match[0])
    expect(tokens.filter((token) => !ALLOWED_TOKENS.has(token))).toEqual([])
  })

  it("has no literal colors", () => {
    expect(TB_CSS).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(white|black)(?![-\w])/,
    )
  })

  it("names only tb- classes", () => {
    const classes = [...TB_CSS.matchAll(/\.(-?[a-z][a-z0-9-]*)/g)].map((match) => match[1])
    expect(classes.filter((name) => !name?.startsWith("tb-"))).toEqual([])
  })

  it("respects reduced motion", () => {
    expect(TB_CSS).toContain("prefers-reduced-motion")
  })
})

describe("client sources", () => {
  it("carry no comments", () => {
    const commented = sources(clientDirectory)
      .filter(({ text }) =>
        text
          .split("\n")
          .some((line) => /(^|\s)\/\/(?!\s*biome-ignore)|\/\*/.test(line) && !line.includes("://")),
      )
      .map(({ path }) => path)
    expect(commented).toEqual([])
  })

  it("import no dsh client package at runtime", () => {
    const importing = sources(clientDirectory)
      .filter(({ text }) => /from "@deepseek-ai\/dsh-client-/.test(text))
      .map(({ path }) => path)
    expect(importing).toEqual([])
  })
})
