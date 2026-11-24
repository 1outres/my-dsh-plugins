export function classNames(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ")
}
