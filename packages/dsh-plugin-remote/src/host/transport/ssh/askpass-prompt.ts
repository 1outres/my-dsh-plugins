import type { RemoteHostKey } from "../../../shared/types"

export type AskpassQuestion =
  | { kind: "hostkey"; changed: boolean; hostKey: RemoteHostKey | undefined }
  | { kind: "secret"; field: "login" | "passphrase"; prompt: string }
  | { kind: "generic"; prompt: string; label: string }

const CHANGED = /host identification has changed/iu
const HOST_KEY = /authenticity of host|fingerprint|\(yes\/no|continue connecting/iu
const PASSPHRASE = /passphrase/iu
const PASSWORD = /password/iu
const AUTHENTICITY_HOST = /authenticity of host '([^']+)'/u
const FINGERPRINT = /([A-Za-z0-9-]+) key fingerprint is (SHA256:[A-Za-z0-9+/=]+)/u
const ANY_FINGERPRINT = /(SHA256:[A-Za-z0-9+/=]+)/u

/**
 * Decide what one ssh askpass prompt asks for. OpenSSH calls askpass for the
 * login password, a key passphrase, keyboard-interactive prompts, and the
 * unknown-host-key confirmation, so the prompt text is the only signal.
 */
export function classifyAskpassPrompt(prompt: string): AskpassQuestion {
  if (CHANGED.test(prompt)) {
    return { kind: "hostkey", changed: true, hostKey: parseHostKey(prompt) }
  }
  if (HOST_KEY.test(prompt)) {
    return { kind: "hostkey", changed: false, hostKey: parseHostKey(prompt) }
  }
  if (PASSPHRASE.test(prompt)) return { kind: "secret", field: "passphrase", prompt }
  if (PASSWORD.test(prompt)) return { kind: "secret", field: "login", prompt }
  return { kind: "generic", prompt, label: promptLabel(prompt) }
}

function parseHostKey(prompt: string): RemoteHostKey | undefined {
  const matchedHost = AUTHENTICITY_HOST.exec(prompt)?.[1]
  const host = matchedHost?.replace(/\s*\(.*$/u, "")
  const algorithm = FINGERPRINT.exec(prompt)?.[1]
  const fingerprint = FINGERPRINT.exec(prompt)?.[2] ?? ANY_FINGERPRINT.exec(prompt)?.[1]
  if (host === undefined && fingerprint === undefined) return undefined
  return {
    host: host ?? "",
    algorithm: algorithm ?? "",
    fingerprint: fingerprint ?? "",
  }
}

/** Short label for a keyboard-interactive prompt the plugin does not know. */
export function promptLabel(prompt: string): string {
  const first =
    prompt
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? prompt.trim()
  return first.replace(/[:\s]+$/u, "")
}
