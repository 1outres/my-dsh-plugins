/** English fallback labels; the browser half localizes known field names again. */
export function secretFieldLabel(field: string, prompt?: string): string {
  switch (field) {
    case "login":
      return "Login password"
    case "sudo":
      return "sudo password"
    case "enable":
      return "Enable password"
    case "passphrase":
      return "Key passphrase"
    default:
      return prompt ?? `Value for ${field}`
  }
}
