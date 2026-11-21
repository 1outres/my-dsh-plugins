import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  BUNDLE_DIRECTORY,
  clientDictionaryProblems,
  colorDistance,
  commonManifestProblems,
  displayResourceProblems,
  displayTextProblems,
  type PackageManifest,
  pluginDirectoryNames,
  pluginManifestProblems,
  readManifest,
  rowIdOf,
  SCOPE,
  tileColorOf,
} from "./support/packages"

const root = fileURLToPath(new URL("..", import.meta.url))
const bundleDirectory = join(root, "packages", BUNDLE_DIRECTORY)
const bundle = readManifest(bundleDirectory)
const plugins = pluginDirectoryNames(root)
const packageDirectories = [...plugins, BUNDLE_DIRECTORY]

/** The smallest RGB distance two icon tiles may have, so no two plugins look alike. */
const MIN_TILE_DISTANCE = 48

describe.each(plugins)("%s", (directoryName) => {
  const directory = join(root, "packages", directoryName)

  it("shares the repository manifest conventions", () => {
    expect(commonManifestProblems(directory, directoryName, bundle)).toEqual([])
    expect(pluginManifestProblems(directory, directoryName)).toEqual([])
  })

  it("ships an en and ja title, description and icon", () => {
    expect(displayResourceProblems(directory)).toEqual([])
    expect(displayTextProblems(directory)).toEqual([])
  })

  it("translates its client copy into en and ja", async () => {
    expect(await clientDictionaryProblems(directory)).toEqual([])
  })
})

describe(BUNDLE_DIRECTORY, () => {
  it("shares the repository manifest conventions", () => {
    expect(commonManifestProblems(bundleDirectory, BUNDLE_DIRECTORY, bundle)).toEqual([])
  })

  it("ships an en and ja title, description and icon", () => {
    expect(displayResourceProblems(bundleDirectory)).toEqual([])
    expect(displayTextProblems(bundleDirectory)).toEqual([])
  })

  it("depends on every plugin package", () => {
    const expected = Object.fromEntries(plugins.map((name) => [`${SCOPE}/${name}`, "workspace:*"]))
    expect(bundle.dependencies).toEqual(expected)
  })

  it("inserts one row for every plugin package", () => {
    const patch = readFileSync(join(bundleDirectory, "cordis.patch.yml"), "utf8")
    for (const name of plugins) {
      expect(patch).toContain(`    - id: ${rowIdOf(name)}\n      name: "${SCOPE}/${name}"`)
    }
  })
})

describe("every package", () => {
  const manifests = packageDirectories.map((name) => readManifest(join(root, "packages", name)))

  it("asks for the same version range of a shared dependency", () => {
    const ranges = new Map<string, Set<string>>()
    const fields = ["dependencies", "peerDependencies", "devDependencies"] as const
    for (const manifest of manifests) {
      for (const field of fields) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (range.startsWith("workspace:")) continue
          ranges.set(name, (ranges.get(name) ?? new Set()).add(range))
        }
      }
    }
    const mixed = [...ranges]
      .filter(([, set]) => set.size > 1)
      .map(([name, set]) => `${name}: ${[...set].join(", ")}`)
    expect(mixed).toEqual([])
  })

  it("has an icon tile color no other package is close to", () => {
    const tiles = packageDirectories.map((name) => {
      const svg = readFileSync(join(root, "packages", name, "icon.svg"), "utf8")
      return [name, tileColorOf(svg) ?? "#000000"] as const
    })
    const close: string[] = []
    for (const [index, [name, color]] of tiles.entries()) {
      for (const [other, otherColor] of tiles.slice(index + 1)) {
        if (colorDistance(color, otherColor) < MIN_TILE_DISTANCE) {
          close.push(`${name} ${color} ~ ${other} ${otherColor}`)
        }
      }
    }
    expect(close).toEqual([])
  })

  it("all carry one version", () => {
    const versions = new Set(manifests.map((manifest: PackageManifest) => manifest.version))
    expect([...versions]).toEqual([bundle.version])
  })
})
