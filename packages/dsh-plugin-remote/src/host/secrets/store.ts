/** In-memory secret values, scoped by root session and target name. */
export class SecretStore {
  readonly #values = new Map<string, Map<string, Map<string, string>>>()

  #session(sessionId: string): Map<string, Map<string, string>> {
    let session = this.#values.get(sessionId)
    if (session === undefined) {
      session = new Map()
      this.#values.set(sessionId, session)
    }
    return session
  }

  set(sessionId: string, target: string, field: string, value: string): void {
    const session = this.#session(sessionId)
    let fields = session.get(target)
    if (fields === undefined) {
      fields = new Map()
      session.set(target, fields)
    }
    fields.set(field, value)
  }

  setMany(sessionId: string, target: string, values: Readonly<Record<string, string>>): void {
    for (const [field, value] of Object.entries(values)) this.set(sessionId, target, field, value)
  }

  get(sessionId: string, target: string, field: string): string | undefined {
    return this.#values.get(sessionId)?.get(target)?.get(field)
  }

  has(sessionId: string, target: string, field: string): boolean {
    return this.get(sessionId, target, field) !== undefined
  }

  names(
    sessionId: string,
    target: string,
    declared: readonly string[],
  ): Array<{ name: string; present: boolean }> {
    return declared.map((name) => ({ name, present: this.has(sessionId, target, name) }))
  }

  fieldNames(sessionId: string, target: string): string[] {
    return [...(this.#values.get(sessionId)?.get(target)?.keys() ?? [])]
  }

  values(sessionId: string, target: string, declared: readonly string[]): string[] {
    const values: string[] = []
    for (const field of declared) {
      const value = this.get(sessionId, target, field)
      if (value !== undefined) values.push(value)
    }
    return values
  }

  deleteField(sessionId: string, target: string, field: string): void {
    this.#values.get(sessionId)?.get(target)?.delete(field)
  }

  deleteTarget(sessionId: string, target: string): void {
    this.#values.get(sessionId)?.delete(target)
  }

  deleteSession(sessionId: string): void {
    this.#values.delete(sessionId)
  }
}
