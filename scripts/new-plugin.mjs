#!/usr/bin/env node
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const requested = process.argv[2]

if (requested === undefined || requested.length === 0) {
  console.error("usage: pnpm new-plugin <kebab-case-name>")
  process.exit(1)
}

if (!/^[a-z][a-z0-9-]*$/.test(requested)) {
  console.error(`invalid plugin name "${requested}": use lowercase kebab-case`)
  process.exit(1)
}

const directoryName = `dsh-plugin-${requested}`
const packageName = `@1outres/${directoryName}`
const packageDir = join(root, "packages", directoryName)
const bundleDir = join(root, "packages", "dsh-plugins")
const bundleManifestPath = join(bundleDir, "package.json")
const patchPath = join(bundleDir, "cordis.patch.yml")

if (existsSync(packageDir)) {
  console.error(`packages/${directoryName} already exists`)
  process.exit(1)
}

const bundleManifest = JSON.parse(await readFile(bundleManifestPath, "utf8"))
const version = bundleManifest.version

const pluginManifest = {
  name: packageName,
  version,
  description: `TODO: describe the ${requested} plugin.`,
  type: "module",
  main: "lib/index.js",
  exports: {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
  },
  files: ["lib"],
  keywords: ["dsh", "dsh-plugin", "deepseek-harness"],
  license: "MIT",
  engines: {
    dsh: ">=0.2.1-rc.5 <0.3.0",
    node: ">=22",
  },
  peerDependencies: {
    "@deepseek-ai/cordis": "~4.0.5",
    react: "^18.2.0",
  },
  dsh: {
    client: {
      platform: "web",
      inject: [],
    },
  },
}

await mkdir(join(packageDir, "src/client"), { recursive: true })
await writeFile(join(packageDir, "package.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`)
await writeFile(
  join(packageDir, "src/index.ts"),
  `import type { Context } from "@deepseek-ai/cordis"

/** Host half. Remove this function's body or the whole file for a pure UI plugin. */
export function apply(_ctx: Context): void {}
`,
)
await writeFile(
  join(packageDir, "src/client/index.tsx"),
  `/** Cordis services required by the browser half. */
export const inject: string[] = []

/** Browser half. Register slots, inject styles, or read \`ctx.configForms\` here. */
export function apply(): void {}
`,
)
await writeFile(
  join(packageDir, "README.md"),
  `# ${packageName}\n\nTODO: describe what the plugin adds and how to configure it.\n`,
)

bundleManifest.dependencies = {
  ...bundleManifest.dependencies,
  [packageName]: "workspace:*",
}
await writeFile(bundleManifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`)

const patch = await readFile(patchPath, "utf8")
if (!patch.includes("\n- insert:")) {
  console.error(`${patchPath} has no insert block; add the row by hand:`)
  console.error(`    - id: ${requested}\n      name: '${packageName}'`)
  process.exit(1)
}
const addition = `    - id: ${requested}\n      name: "${packageName}"`
await writeFile(patchPath, `${patch.trimEnd()}\n${addition}\n`)

console.log(`created packages/${directoryName} (${packageName})`)
console.log(`added the "${requested}" row to packages/dsh-plugins/cordis.patch.yml`)
console.log("next: pnpm install && pnpm build")
