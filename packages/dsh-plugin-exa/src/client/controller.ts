import { isHttpURL } from "../shared/url"
import { normalizeConfig, PROVIDER_ID, parseDomains } from "./config"
import type {
  ConfigForm,
  ConfigFormSnapshot,
  CredentialInfo,
  CredentialsRemote,
  ExaConfig,
  RemoteResult,
  SearchContents,
  SearchType,
  WebConfig,
} from "./types"

/** Number fields the page validates before writing. */
export type NumberField = "searchMaxCharacters" | "fetchMaxCharacters"

/** Free-text fields the page validates before writing. */
export type TextField = "baseURL" | "apiKeyEnv"

/** Textarea fields that hold one domain per line. */
export type DomainField = "includeDomains" | "excludeDomains"

/** Select fields with a fixed set of choices. */
export type SelectField = "searchType" | "searchContents"

/** Fields that can carry an inline validation error. */
export type EditionField = NumberField | TextField

interface NumberRule {
  readonly min: number
  readonly max: number
  readonly error: string
}

/** Ranges accepted by the Host schema, with the message key shown on a miss. */
export const NUMBER_RULES: Record<NumberField, NumberRule> = {
  searchMaxCharacters: { min: 100, max: 20000, error: "invalidSearchMaxCharacters" },
  fetchMaxCharacters: { min: 1000, max: 1000000, error: "invalidFetchMaxCharacters" },
}

const API_KEY_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** Credential facts plus the last failure of a key read or write. */
export interface CredentialState {
  readonly ref: string
  readonly configured: boolean
  readonly writable: boolean
  readonly source?: string
  readonly error?: string
}

/** Everything the settings page renders, published as one immutable value. */
export interface ExaSettingsSnapshot {
  readonly status: ConfigFormSnapshot<unknown>["status"]
  readonly writable: boolean
  readonly config: ExaConfig
  readonly web: { readonly search: boolean; readonly fetch: boolean }
  readonly credential: CredentialState
  readonly errors: Partial<Record<EditionField, string>>
  readonly writeError: boolean
}

export interface ExaSettingsControllerOptions {
  readonly form: ConfigForm<ExaConfig>
  readonly webForm: ConfigForm<WebConfig>
  readonly credentials: CredentialsRemote
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * State and actions of the Exa settings page. It owns the key read/write
 * lifecycle, the validation before a settings write, and the snapshot the
 * React view renders; it holds no JSX.
 */
export class ExaSettingsController {
  private readonly options: ExaSettingsControllerOptions
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: (() => void)[]
  private current: ExaSettingsSnapshot
  private credential: CredentialState
  private errors: Partial<Record<EditionField, string>> = {}
  private writeError = false
  private readSequence = 0
  private disposed = false

  constructor(options: ExaSettingsControllerOptions) {
    this.options = options
    this.credential = { ref: this.ref(), configured: false, writable: false }
    this.current = this.project()
    this.unsubscribe = [
      options.form.subscribe(() => this.handleFormChange()),
      options.webForm.subscribe(() => this.publish()),
    ]
    void this.readCredential()
  }

  getSnapshot(): ExaSettingsSnapshot {
    return this.current
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.unsubscribe) off()
    this.listeners.clear()
  }

  /** Re-read the key state after a `credentials/reference-updated` event. */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /** Store a new key, then re-read whether the Host now has one. */
  async saveKey(value: string): Promise<boolean> {
    const ref = this.ref()
    return this.callCredential(() => this.options.credentials.set(ref, value))
  }

  /** Remove the stored key, then re-read the state. */
  async removeKey(): Promise<boolean> {
    const ref = this.ref()
    return this.callCredential(() => this.options.credentials.unset(ref))
  }

  /** Validate and write a number field, or report an inline error. */
  commitNumber(field: NumberField, text: string): Promise<boolean> {
    const value = text.trim()
    if (value === "") {
      this.clearError(field)
      return this.write(field, undefined)
    }
    const number = Number(value)
    const rule = NUMBER_RULES[field]
    if (!Number.isInteger(number) || number < rule.min || number > rule.max) {
      this.setError(field, rule.error)
      return Promise.resolve(false)
    }
    this.clearError(field)
    return this.write(field, number)
  }

  /** Validate and write a text field, or report an inline error. */
  commitText(field: TextField, text: string): Promise<boolean> {
    const value = text.trim()
    if (value === "") {
      this.clearError(field)
      return this.write(field, undefined)
    }
    const error = this.validateText(field, value)
    if (error !== undefined) {
      this.setError(field, error)
      return Promise.resolve(false)
    }
    this.clearError(field)
    return this.write(field, value)
  }

  /** Write a domain list; an empty textarea clears the filter. */
  commitDomains(field: DomainField, text: string): Promise<boolean> {
    const domains = parseDomains(text)
    return this.write(field, domains.length === 0 ? undefined : domains)
  }

  /** Write one of the fixed select choices. */
  commitSelect(field: SelectField, value: SearchType | SearchContents): Promise<boolean> {
    return this.write(field, value)
  }

  private ref(): string {
    return normalizeConfig(this.options.form.getSnapshot().value).apiKeyEnv
  }

  private project(): ExaSettingsSnapshot {
    const form = this.options.form.getSnapshot()
    const web = this.options.webForm.getSnapshot()
    return {
      status: form.status,
      writable: form.writable,
      config: normalizeConfig(form.value),
      web: {
        search: web.value?.searchProvider === PROVIDER_ID,
        fetch: web.value?.fetchProvider === PROVIDER_ID,
      },
      credential: this.credential,
      errors: this.errors,
      writeError: this.writeError,
    }
  }

  private publish(): void {
    if (this.disposed) return
    this.current = this.project()
    for (const listener of [...this.listeners]) listener()
  }

  private handleFormChange(): void {
    const ref = this.ref()
    if (ref !== this.credential.ref) {
      this.resetCredential(ref)
      this.publish()
      void this.readCredential()
      return
    }
    this.publish()
  }

  private resetCredential(ref: string): void {
    this.credential = { ref, configured: false, writable: false }
    this.readSequence += 1
  }

  private async readCredential(): Promise<void> {
    if (this.disposed) return
    const ref = this.ref()
    if (ref !== this.credential.ref) this.resetCredential(ref)
    const sequence = ++this.readSequence

    let response: RemoteResult<Record<string, CredentialInfo>>
    try {
      response = await this.options.credentials.describe([ref])
    } catch (error) {
      if (this.disposed || sequence !== this.readSequence) return
      this.credential = { ref, configured: false, writable: false, error: errorText(error) }
      this.publish()
      return
    }
    if (this.disposed || sequence !== this.readSequence || ref !== this.ref()) return
    if (!response.ok) {
      this.credential = {
        ref,
        configured: false,
        writable: false,
        error: response.error.message,
      }
      this.publish()
      return
    }

    const info = response.value[ref]
    this.credential = {
      ref,
      configured: info?.configured ?? false,
      writable: info?.writable ?? false,
      ...(info?.source === undefined ? {} : { source: info.source }),
    }
    this.publish()
  }

  private async callCredential(call: () => Promise<RemoteResult<void>>): Promise<boolean> {
    let response: RemoteResult<void>
    try {
      response = await call()
    } catch (error) {
      this.failCredential(errorText(error))
      return false
    }
    if (!response.ok) {
      this.failCredential(response.error.message)
      return false
    }
    await this.readCredential()
    return true
  }

  private failCredential(message: string): void {
    this.credential = { ...this.credential, error: message }
    this.publish()
  }

  private validateText(field: TextField, value: string): string | undefined {
    if (field === "baseURL") return isHttpURL(value) ? undefined : "invalidBaseURL"
    return API_KEY_ENV_PATTERN.test(value) ? undefined : "invalidApiKeyEnv"
  }

  private async write(field: string, value: unknown): Promise<boolean> {
    try {
      const accepted =
        value === undefined
          ? await this.options.form.unset(field)
          : await this.options.form.set(field, value)
      this.setWriteError(!accepted)
      return accepted
    } catch {
      this.setWriteError(true)
      return false
    }
  }

  private setError(field: EditionField, error: string): void {
    this.errors = { ...this.errors, [field]: error }
    this.publish()
  }

  private clearError(field: EditionField): void {
    if (this.errors[field] === undefined) return
    const next = { ...this.errors }
    delete next[field]
    this.errors = next
    this.publish()
  }

  private setWriteError(failed: boolean): void {
    if (this.writeError === failed) return
    this.writeError = failed
    this.publish()
  }
}
