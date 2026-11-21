import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** The fields of a package.json that the repository conventions look at. */
export interface PackageManifest {
  name: string
  version: string
  description?: string
  keywords?: string[]
  license?: string
  main?: string
  type?: string
  repository?: { type?: string; url?: string; directory?: string }
  exports?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
  engines?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string[] }; client?: { platform?: string; inject?: string[] } }
}

export interface DisplayLocale {
  meta?: { title?: unknown; description?: unknown }
  [key: string]: unknown
}

export const SCOPE = "@1outres"
export const BUNDLE_DIRECTORY = "dsh-plugins"
export const PLUGIN_PREFIX = "dsh-plugin-"
export const REPOSITORY_URL = "git+https://github.com/1outres/my-dsh-plugins.git"
export const DISPLAY_LANGUAGES = ["en", "ja"] as const
export const ICON_SIZE = 64
export const MAX_ICON_BYTES = 256 * 1024
export const BUILD_SCRIPT = "node ../../scripts/build.mjs"

/** Words that keep their capital letter inside a sentence-case title. */
const PROPER_NOUNS = new Set(["Claude", "DSH", "Exa", "Playwright"])

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

export function readManifest(directory: string): PackageManifest {
  return readJson<PackageManifest>(join(directory, "package.json"))
}

/** Directory names of the plugin packages under `packages/`, sorted. */
export function pluginDirectoryNames(root: string): string[] {
  return readdirSync(join(root, "packages"))
    .filter((name) => name.startsWith(PLUGIN_PREFIX))
    .sort()
}

export function rowIdOf(directoryName: string): string {
  return directoryName.slice(PLUGIN_PREFIX.length)
}

export function readLocale(directory: string, language: string): DisplayLocale | undefined {
  const path = join(directory, "locale", `${language}.json`)
  return existsSync(path) ? readJson<DisplayLocale>(path) : undefined
}

function sortedKeys(record: object): string[] {
  return Object.keys(record).sort()
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function missingFrom(list: readonly string[] | undefined, required: readonly string[]): string[] {
  return required.filter((entry) => !(list ?? []).includes(entry))
}

/**
 * Manifest fields every package in this repository shares: identity, license,
 * repository link, engines, and the bundle patch.
 */
export function commonManifestProblems(
  directory: string,
  directoryName: string,
  reference: PackageManifest,
): string[] {
  const manifest = readManifest(directory)
  const problems: string[] = []
  if (manifest.name !== `${SCOPE}/${directoryName}`) problems.push(`name is ${manifest.name}`)
  if (manifest.version !== reference.version) problems.push(`version ${manifest.version} differs`)
  if (manifest.type !== "module") problems.push("type is not module")
  if (manifest.license !== "MIT") problems.push("license is not MIT")
  if (!existsSync(join(directory, "LICENSE"))) problems.push("LICENSE file is missing")
  if (manifest.repository?.url !== REPOSITORY_URL) problems.push("repository url differs")
  if (manifest.repository?.directory !== `packages/${directoryName}`) {
    problems.push("repository directory differs")
  }
  if (JSON.stringify(manifest.engines) !== JSON.stringify(reference.engines)) {
    problems.push("engines differ from the bundle")
  }
  if (manifest.dsh?.bundle?.patch?.[0] !== "./cordis.patch.yml") {
    problems.push("dsh.bundle.patch does not start with ./cordis.patch.yml")
  }
  for (const key of ["./locale/*.json", "./package.json"]) {
    if (manifest.exports?.[key] !== key) problems.push(`exports lacks ${key}`)
  }
  if (manifest.exports?.["./icon"] !== "./icon.svg") problems.push("exports lacks ./icon")
  for (const file of missingFrom(manifest.files, [
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
  ])) {
    problems.push(`files lacks ${file}`)
  }
  return problems
}

/** Manifest fields of a plugin package on top of the common ones. */
export function pluginManifestProblems(directory: string, directoryName: string): string[] {
  const manifest = readManifest(directory)
  const problems: string[] = []
  if (manifest.main !== undefined && manifest.main !== "lib/index.js") problems.push("main differs")
  if (manifest.exports?.["."] !== "./lib/index.js") problems.push("exports . is not ./lib/index.js")
  if (!(manifest.files ?? []).includes("lib")) problems.push("files lacks lib")
  if (manifest.scripts?.prepublishOnly !== BUILD_SCRIPT) problems.push("prepublishOnly differs")
  if (JSON.stringify(manifest.dsh?.bundle?.patch) !== JSON.stringify(["./cordis.patch.yml"])) {
    problems.push("dsh.bundle.patch is not [./cordis.patch.yml]")
  }
  if (manifest.peerDependencies?.["@deepseek-ai/cordis"] === undefined) {
    problems.push("peerDependencies lacks @deepseek-ai/cordis")
  }
  const hasClient = manifest.exports?.["./client"] !== undefined
  if (hasClient !== (manifest.dsh?.client !== undefined)) {
    problems.push("exports ./client and dsh.client must come together")
  }
  if (hasClient && manifest.exports?.["./client"] !== "./lib/client.js") {
    problems.push("exports ./client is not ./lib/client.js")
  }
  for (const keyword of missingFrom(manifest.keywords, ["dsh", "dsh-plugin", "deepseek-harness"])) {
    problems.push(`keywords lack ${keyword}`)
  }
  const patch = readFileSync(join(directory, "cordis.patch.yml"), "utf8")
  const row = `    - id: ${rowIdOf(directoryName)}\n      name: "${manifest.name}"`
  if (!patch.includes(row)) problems.push("cordis.patch.yml does not insert its own row")
  return problems
}

/** Locale files and the icon that Plugin Manager and Settings read. */
export function displayResourceProblems(directory: string): string[] {
  const problems: string[] = []
  const locales = DISPLAY_LANGUAGES.map(
    (language) => [language, readLocale(directory, language)] as const,
  )
  for (const [language, locale] of locales) {
    if (locale === undefined) {
      problems.push(`locale/${language}.json is missing`)
      continue
    }
    if (!nonEmpty(locale.meta?.title)) problems.push(`locale/${language}.json lacks meta.title`)
    if (!nonEmpty(locale.meta?.description)) {
      problems.push(`locale/${language}.json lacks meta.description`)
    }
  }
  const [, english] = locales[0]
  for (const [language, locale] of locales.slice(1)) {
    if (english === undefined || locale === undefined) continue
    if (JSON.stringify(sortedKeys(locale)) !== JSON.stringify(sortedKeys(english))) {
      problems.push(`locale/${language}.json keys differ from en`)
    }
  }
  problems.push(...iconProblems(directory, english?.meta?.title))
  return problems
}

function iconProblems(directory: string, title: unknown): string[] {
  const path = join(directory, "icon.svg")
  if (!existsSync(path)) return ["icon.svg is missing"]
  const problems: string[] = []
  if (statSync(path).size > MAX_ICON_BYTES) problems.push("icon.svg exceeds 256 KiB")
  const svg = readFileSync(path, "utf8")
  const open = /^<svg\b[^>]*>/.exec(svg.trimStart())?.[0]
  if (open === undefined) return [...problems, "icon.svg does not start with <svg>"]
  for (const attribute of [
    'xmlns="http://www.w3.org/2000/svg"',
    `width="${ICON_SIZE}"`,
    `height="${ICON_SIZE}"`,
    `viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}"`,
    'role="img"',
  ]) {
    if (!open.includes(attribute)) problems.push(`icon.svg <svg> lacks ${attribute}`)
  }
  if (!svg.trimEnd().endsWith("</svg>")) problems.push("icon.svg does not end with </svg>")
  if (tileColorOf(svg) === undefined) problems.push("icon.svg has no background tile")
  const iconTitle = /<title\b[^>]*>([^<]*)<\/title>/.exec(svg)?.[1]
  if (iconTitle !== title) problems.push(`icon.svg title "${iconTitle}" differs from "${title}"`)
  return problems
}

/** The fill of the rounded 60x60 tile every icon draws first. */
export function tileColorOf(svg: string): string | undefined {
  return /<rect x="2" y="2" width="60" height="60" rx="14" fill="(#[0-9A-Fa-f]{6})"\s*\/>/.exec(
    svg,
  )?.[1]
}

/** Text a person reads: no placeholders, sentence-case English, consistent Japanese terms. */
export function displayTextProblems(directory: string): string[] {
  const problems: string[] = []
  const manifest = readManifest(directory)
  if (!nonEmpty(manifest.description) || manifest.description.includes("TODO")) {
    problems.push("package.json description is a placeholder")
  } else if (!manifest.description.includes("DeepSeek Harness")) {
    problems.push("package.json description does not name DeepSeek Harness")
  }
  const english = readLocale(directory, "en")
  const japanese = readLocale(directory, "ja")
  for (const text of [
    english?.meta?.title,
    english?.meta?.description,
    japanese?.meta?.description,
  ]) {
    if (typeof text === "string" && text.includes("TODO"))
      problems.push(`placeholder text: ${text}`)
  }
  const title = english?.meta?.title
  if (typeof title === "string") {
    const capitalized = title
      .split(" ")
      .slice(1)
      .filter((word) => /^[A-Z][a-z]/.test(word) && !PROPER_NOUNS.has(word))
    if (capitalized.length > 0) problems.push(`title is not sentence case: ${title}`)
  }
  if (japanese !== undefined && /\bSession\b/.test(JSON.stringify(japanese))) {
    problems.push("ja text writes Session instead of セッション")
  }
  return problems
}

/** Client dictionaries in `src/client/i18n.ts` translate the same keys in en and ja. */
export async function clientDictionaryProblems(directory: string): Promise<string[]> {
  const path = join(directory, "src", "client", "i18n.ts")
  if (!existsSync(path)) return []
  const dictionaries = (await import(pathToFileURL(path).href)) as Record<string, unknown>
  const problems: string[] = []
  for (const language of DISPLAY_LANGUAGES) {
    if (typeof dictionaries[language] !== "object")
      problems.push(`i18n.ts does not export ${language}`)
  }
  const english = dictionaries.en
  const japanese = dictionaries.ja
  if (
    typeof english === "object" &&
    english !== null &&
    typeof japanese === "object" &&
    japanese !== null
  ) {
    if (JSON.stringify(sortedKeys(japanese)) !== JSON.stringify(sortedKeys(english))) {
      problems.push("i18n.ts ja keys differ from en")
    }
    if (/\bSession\b/.test(JSON.stringify(japanese))) {
      problems.push("i18n.ts ja writes Session instead of セッション")
    }
  }
  return problems
}

/** Distance between two #RRGGBB colors in RGB space. */
export function colorDistance(left: string, right: string): number {
  const channels = (color: string) =>
    [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16))
  const [a, b] = [channels(left), channels(right)]
  return Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)))
}
