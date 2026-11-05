import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const EVALS = ["admission.ts", "cache-wire.ts"]
const directory = new URL("./", import.meta.url)
const resolver = fileURLToPath(new URL("support/resolve-typescript.mjs", directory))
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("usage: pnpm run eval /absolute/path/to/claude")
  process.exit(2)
}

let failed = false
for (const name of EVALS) {
  console.log(`== ${name}`)
  const { status } = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      resolver,
      fileURLToPath(new URL(name, directory)),
      ...args,
    ],
    { stdio: "inherit" },
  )
  if (status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
