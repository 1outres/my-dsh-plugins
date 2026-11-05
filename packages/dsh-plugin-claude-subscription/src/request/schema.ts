import type { JsonObject } from "../contract"

const UNION_KEYS = ["anyOf", "oneOf"] as const
const UNION_META_KEYS = ["title", "description", "default", "examples"] as const
const BANNED_TOP_LEVEL_KEYS = ["oneOf", "allOf", "anyOf"] as const

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rewrite(node: unknown, visit: (object: JsonObject) => unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => rewrite(item, visit))
  if (!isObject(node)) return node
  const children = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, rewrite(value, visit)]),
  )
  return visit(children)
}

function isNullBranch(branch: unknown): boolean {
  return isObject(branch) && branch.type === "null"
}

function carryUnionMeta(outer: JsonObject, replacement: JsonObject): void {
  for (const key of UNION_META_KEYS) {
    if (!Object.hasOwn(outer, key) || Object.hasOwn(replacement, key)) continue
    if (key === "default" && Object.hasOwn(replacement, "$ref")) continue
    replacement[key] = outer[key]
  }
}

function collapseNullableUnion(union: JsonObject): unknown {
  for (const key of UNION_KEYS) {
    const variants = union[key]
    if (!Array.isArray(variants)) continue
    const nonNull = variants.filter((branch) => !isNullBranch(branch))
    if (nonNull.length !== 1 || nonNull.length === variants.length) continue
    const survivor = nonNull[0]
    const replacement: JsonObject = isObject(survivor) ? { ...survivor } : {}
    carryUnionMeta(union, replacement)
    return rewrite(replacement, collapseNullableUnion)
  }
  return union
}

/**
 * Collapses `anyOf` and `oneOf` unions that exist only to allow null into their one other
 * branch. Anthropic rejects the null branch, and optionality already lives in `required`.
 */
export function stripNullableUnions(schema: unknown): unknown {
  return rewrite(schema, collapseNullableUnion)
}

/**
 * Makes a tool schema acceptable to Anthropic's validator, which rejects top-level
 * `oneOf`, `allOf` and `anyOf` and the null branch of nullable unions. The combinators are
 * dropped because they only state conditions the tool re-checks itself.
 */
export function normalizeInputSchema(schema: JsonObject): JsonObject {
  let normalized = stripNullableUnions(schema) as JsonObject
  if (BANNED_TOP_LEVEL_KEYS.some((key) => key in normalized)) {
    normalized = Object.fromEntries(
      Object.entries(normalized).filter(
        ([key]) => !(BANNED_TOP_LEVEL_KEYS as readonly string[]).includes(key),
      ),
    )
    if (!("type" in normalized)) normalized.type = "object"
  }
  if (normalized.type === "object" && !isObject(normalized.properties)) {
    normalized = { ...normalized, properties: {} }
  }
  return normalized
}
