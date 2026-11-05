import { existsSync } from "node:fs"
import { registerHooks } from "node:module"

// The sources import each other with no file extension, as the bundler allows. Node needs the file.
function typescriptFile(specifier, parentURL) {
  if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier) || parentURL === undefined) {
    return undefined
  }
  const url = new URL(`${specifier}.ts`, parentURL)
  return existsSync(url) ? url.href : undefined
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(typescriptFile(specifier, context.parentURL) ?? specifier, context)
  },
})
