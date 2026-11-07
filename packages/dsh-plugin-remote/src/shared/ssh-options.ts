export class SshOptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SshOptionError"
  }
}

const OPTION = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/u

/** Split `Key=Value` into the option name and value. */
export function splitSshOption(option: string): { key: string; value: string } {
  const match = OPTION.exec(option)
  if (match === null)
    throw new SshOptionError(`ssh option ${JSON.stringify(option)} must look like Key=Value`)
  return { key: match[1] as string, value: match[2] as string }
}

/**
 * Validate the options the model supplied. Options that could run a local
 * command are refused, because a registered target must not become a way to
 * execute code on the host.
 */
export function validateSshOptions(
  options: readonly string[],
  blocked: readonly string[],
): string[] {
  const blockedSet = new Set(blocked.map((name) => name.toLowerCase()))
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const option of options) {
    const { key } = splitSshOption(option)
    const lower = key.toLowerCase()
    if (blockedSet.has(lower)) {
      throw new SshOptionError(`ssh option ${JSON.stringify(key)} is not allowed`)
    }
    if (seen.has(lower)) {
      throw new SshOptionError(`ssh option ${JSON.stringify(key)} is given more than once`)
    }
    seen.add(lower)
    normalized.push(option)
  }
  return normalized
}
