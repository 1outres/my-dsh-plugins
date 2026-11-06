import type { ComponentType } from "react"

/**
 * The slices of the Harness Client contracts this plugin uses. The plugin
 * depends on these shapes instead of importing the owning packages.
 */

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export type EnterKey = "newline" | "send"

/** Values of the plugin's settings entry, after defaults are applied. */
export interface MobileConfig {
  enterKey: EnterKey
  swipe: boolean
  fitKeyboard: boolean
  blockPullToRefresh: boolean
  autoFocusComposer: boolean
}

/**
 * Whether the Harness currently shows its phone layout, and whether the
 * browser reports a touch screen.
 */
export interface PageState {
  readonly mobile: boolean
  readonly touch: boolean
}

export interface ConfigFormSnapshot<T> {
  status: "loading" | "ready" | "unavailable"
  value: T | undefined
  /** False when a higher layer (home patch, command line) owns the entry. */
  writable?: boolean
}

export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  /** Write one field to the profile patch; resolves to whether the Host accepted it. */
  set(field: string, value: unknown): Promise<boolean>
  /** Drop the profile override so the schema default applies again. */
  unset(field: string): Promise<boolean>
}

export interface ConfigFormsService {
  get<T>(namespace: string): ConfigForm<T>
  /** Run `register` while the Host serves forms for these namespaces. */
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: Record<string, unknown>, component: ComponentType<any>): () => void
}

/** `ctx.layout` (`@deepseek-ai/dsh-client-ui-layout`). */
export interface LayoutService {
  /** Flip the Harness navigation drawer below 768px, or the sidebar elsewhere. */
  toggleSidebar(): void
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  layout: LayoutService
}
