import type { LimitField } from "../shared/settings"
import { effortChoices, findRoute, type RouteGroup, routeGroups, routeKey } from "./catalog"
import type {
  AdvisorFormValues,
  ConfigForm,
  ConfigFormSnapshot,
  ModelCatalog,
  ModelProviderGroup,
  ModelReasoningEffort,
  RemoteResult,
  SettingsPathOp,
} from "./types"
import { parseLimit, readFormValues } from "./values"

export type CatalogState =
  | { readonly status: "idle" | "loading" | "ready"; readonly partial: boolean }
  | { readonly status: "error"; readonly partial: boolean; readonly error: string }

export interface AdvisorSettingsSnapshot {
  readonly status: ConfigFormSnapshot<unknown>["status"]
  readonly writable: boolean
  readonly values: AdvisorFormValues
  readonly catalog: CatalogState
  readonly routeGroups: readonly RouteGroup[]
  readonly selectedKey: string
  readonly efforts: readonly ModelReasoningEffort[]
  readonly errors: Partial<Record<LimitField, string>>
  readonly writeError: boolean
}

export interface AdvisorSettingsControllerOptions {
  readonly form: ConfigForm<AdvisorFormValues>
  readonly loadCatalog: () => Promise<RemoteResult<ModelCatalog>>
}

const LIMIT_ERRORS: Readonly<Record<LimitField, string>> = {
  adviceWordLimit: "invalidAdviceWordLimit",
  timeoutMs: "invalidTimeoutMs",
}

const CLEAR_ROUTE: readonly SettingsPathOp[] = [
  { op: "unset", path: ["provider"] },
  { op: "unset", path: ["model"] },
  { op: "unset", path: ["reasoningEffort"] },
]

export class AdvisorSettingsController {
  private readonly options: AdvisorSettingsControllerOptions
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private groups: readonly ModelProviderGroup[] = []
  private catalog: CatalogState = { status: "idle", partial: false }
  private catalogGeneration = 0
  private errors: Partial<Record<LimitField, string>> = {}
  private writeError = false
  private disposed = false
  private current: AdvisorSettingsSnapshot

  constructor(options: AdvisorSettingsControllerOptions) {
    this.options = options
    this.current = this.project()
    this.unsubscribe = options.form.subscribe(() => this.publish())
  }

  getSnapshot(): AdvisorSettingsSnapshot {
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
    this.catalogGeneration += 1
    this.unsubscribe()
    this.listeners.clear()
  }

  ensureCatalog(): void {
    if (this.catalog.status === "idle") void this.loadCatalog()
  }

  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalog = { status: "idle", partial: false }
    void this.loadCatalog()
  }

  selectRoute(key: string): Promise<boolean> {
    if (key === "") return this.write(CLEAR_ROUTE)
    const route = findRoute(this.current.routeGroups, key)
    if (route === undefined) return Promise.resolve(false)
    return this.write([
      { op: "set", path: ["provider"], value: route.provider },
      { op: "set", path: ["model"], value: route.model },
      { op: "unset", path: ["reasoningEffort"] },
    ])
  }

  selectEffort(id: string): Promise<boolean> {
    return this.write([
      id === ""
        ? { op: "unset", path: ["reasoningEffort"] }
        : { op: "set", path: ["reasoningEffort"], value: id },
    ])
  }

  commitLimit(field: LimitField, text: string): Promise<boolean> {
    const value = parseLimit(field, text)
    if (value === undefined) {
      this.errors = { ...this.errors, [field]: LIMIT_ERRORS[field] }
      this.publish()
      return Promise.resolve(false)
    }
    const { [field]: _cleared, ...rest } = this.errors
    this.errors = rest
    return this.write([{ op: "set", path: [field], value }])
  }

  private async loadCatalog(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.catalogGeneration
    this.catalog = { status: "loading", partial: false }
    this.publish()
    let response: RemoteResult<ModelCatalog>
    try {
      response = await this.options.loadCatalog()
    } catch (error) {
      if (generation !== this.catalogGeneration) return
      this.catalog = {
        status: "error",
        partial: false,
        error: error instanceof Error ? error.message : String(error),
      }
      this.publish()
      return
    }
    if (generation !== this.catalogGeneration) return
    if (response.ok) {
      this.groups = response.value.groups
      this.catalog = { status: "ready", partial: response.value.failures.length > 0 }
    } else {
      this.catalog = { status: "error", partial: false, error: response.error.message }
    }
    this.publish()
  }

  private async write(ops: readonly SettingsPathOp[]): Promise<boolean> {
    if (!this.options.form.getSnapshot().writable) {
      this.publish()
      return false
    }
    let accepted: boolean
    try {
      accepted = await this.options.form.mutate(ops)
    } catch {
      accepted = false
    }
    this.writeError = !accepted
    this.publish()
    return accepted
  }

  private project(): AdvisorSettingsSnapshot {
    const form = this.options.form.getSnapshot()
    const values = readFormValues(form.value)
    const configured = values.provider !== "" && values.model !== ""
    return {
      status: form.status,
      writable: form.writable,
      values,
      catalog: this.catalog,
      routeGroups: routeGroups(this.groups, values),
      selectedKey: configured ? routeKey(values.provider, values.model) : "",
      efforts: configured ? effortChoices(this.groups, values.provider, values.model) : [],
      errors: this.errors,
      writeError: this.writeError,
    }
  }

  private publish(): void {
    if (this.disposed) return
    this.current = this.project()
    for (const listener of [...this.listeners]) listener()
  }
}
