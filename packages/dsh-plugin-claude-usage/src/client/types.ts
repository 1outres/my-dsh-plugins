import type { ComponentType } from "react"
import type {
  RateLimitSnapshot,
  UsageReport,
  UsageReportResult,
  UsageStreamState,
} from "../shared/contract"

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface UsageState {
  /** True once the Host stream delivered its first item. */
  connected: boolean
  snapshot: RateLimitSnapshot | null
}

export interface UsageStore {
  getSnapshot(): UsageState
  subscribe(listener: () => void): () => void
  receive(item: UsageStreamState): void
  reset(): void
}

export interface UsageStreamHandle extends AsyncIterable<UsageStreamState> {
  dispose(): void
}

export type RemoteUsageResult =
  | { ok: true; value: UsageReportResult }
  | { ok: false; error?: { message?: string } }

export interface UsageRemote {
  snapshots(): UsageStreamHandle
  report(): Promise<RemoteUsageResult>
}

export interface RemoteService {
  $mount(contribution: unknown): Promise<() => Promise<void>>
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: Record<string, unknown>, component: ComponentType<any>): () => void
}

export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

/** The slice of the browser Cordis context this plugin uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  /** Unguarded lookup, used for the namespace this plugin mounts itself. */
  get(name: string): unknown
  slots: SlotsService
  locale: LocaleService
  remote: RemoteService
}

export interface UsageBridge {
  store: UsageStore
  loadReport(): Promise<UsageReportResult>
  dispose(): void
}

export type ReportView =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: UsageReport }
  | { status: "error"; message?: string }
