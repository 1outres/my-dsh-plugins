import type { ComponentType } from "react"

/** Values persisted in the plugin's settings entry. */
export interface BackgroundConfig {
  /** Master switch. Off removes every visual effect. */
  enabled: boolean
  /** Absolute Host path or an http(s) URL. */
  image: string
  /** How opaque interface surfaces stay over the image, 0-100. */
  panelOpacity: number
  /** Black veil strength between the image and the interface, 0-100. */
  dim: number
  /** Image blur in CSS pixels, 0-40. */
  blur: number
}

export interface ConfigFormSnapshot<T> {
  status: "loading" | "ready" | "unavailable"
  value: T | undefined
  revision: number | undefined
  writable: boolean
}

export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

export interface ThemeDefinition {
  id: string
  colorScheme: "light" | "dark"
  tokens: Record<string, string>
}

export interface ThemeSnapshot {
  active: ThemeDefinition
  revision: number
}

export interface SlotRegistration {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  locale?: string
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  register(options: SlotRegistration, component: ComponentType): () => void
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface ConfigFormsService {
  get<T>(namespace: string): ConfigForm<T>
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

export interface ThemeService {
  getTheme(): ThemeSnapshot
  overrideTokens(
    source: string,
    tokens: Record<string, { light: string; dark: string }>,
  ): () => void
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  on(event: "theme/change", listener: (snapshot: ThemeSnapshot) => void): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  theme: ThemeService
}
