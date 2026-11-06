import type { ComponentType } from "react"

/**
 * The slices of the Harness Client contracts this plugin uses. The plugin
 * depends on these shapes instead of importing the owning packages.
 */

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export type LayoutMode = "auto" | "always" | "off"
export type EnterKey = "newline" | "send"

/** Values of the plugin's settings entry, after defaults are applied. */
export interface MobileConfig {
  mode: LayoutMode
  breakpoint: number
  enterKey: EnterKey
  swipe: boolean
  fitKeyboard: boolean
  blockPullToRefresh: boolean
  autoFocusComposer: boolean
}

/** Whether the page currently uses the phone layout, and whether it is a touch screen. */
export interface ModeState {
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

export interface SlotRegistration {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  locale?: string
  inject?: () => object
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: SlotRegistration, component: ComponentType<any>): () => void
}

/** `ctx.layout` (`@deepseek-ai/dsh-client-ui-layout`). */
export interface LayoutService {
  /** Below 1024px this flips the sidebar between the rail and the expanded column. */
  toggleSidebar(): void
}

/** Standard slot hook: the selected global panel, null while the Conversation shows. */
export interface PanelInfo {
  readonly activePanelId: string | null
}
export type UsePanelInfo = <T>(selector: (info: PanelInfo) => T) => T

/** Standard slot hook over the Session list (`@deepseek-ai/dsh-api-session-controller`). */
export interface SessionRow {
  readonly id?: string
  /** Retain counts; `mainView` is positive for the Session the main column shows. */
  readonly retainedBy?: { readonly mainView?: number }
}
export interface SessionsState {
  readonly byId: Readonly<Record<string, SessionRow | undefined>>
}
export type UseSessions = <T>(selector: (state: SessionsState) => T) => T

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  layout: LayoutService
}
