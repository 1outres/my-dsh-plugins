const OBJECT_PROTOTYPE = Object.prototype
const ARRAY_PROTOTYPE = Array.prototype

function isLosslessNumber(value: number): boolean {
  return Number.isFinite(value) && !Object.is(value, -0)
}

function isLosslessArray(value: unknown[], ancestors: Set<object>): boolean {
  if (Object.getPrototypeOf(value) !== ARRAY_PROTOTYPE) return false
  if (Reflect.ownKeys(value).length !== value.length + 1) return false
  return value.every(
    (_item, index) => Object.hasOwn(value, index) && isLossless(value[index], ancestors),
  )
}

function isLosslessObject(value: object, ancestors: Set<object>): boolean {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) return false
  const keys = Reflect.ownKeys(value)
  return keys.every(
    (key) =>
      typeof key === "string" &&
      Object.prototype.propertyIsEnumerable.call(value, key) &&
      isLossless((value as Record<string, unknown>)[key], ancestors),
  )
}

function isLossless(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true
  if (typeof value === "number") return isLosslessNumber(value)
  if (typeof value !== "object" || ancestors.has(value)) return false
  ancestors.add(value)
  const lossless = Array.isArray(value)
    ? isLosslessArray(value, ancestors)
    : isLosslessObject(value, ancestors)
  ancestors.delete(value)
  return lossless
}

/**
 * Whether DSH can store the value. DSH rejects a number that is not finite, a negative zero and
 * anything that a JSON round trip would change, and a rejected chunk ends the whole call.
 */
export function isLosslessJson(value: unknown): boolean {
  return isLossless(value, new Set())
}
