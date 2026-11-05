import type { ImageAttachmentRef, ImageRequestTarget } from "@deepseek-ai/dsh-attachment"
import type {
  ContentBlock,
  GenerateOptions,
  LlmAdapter,
  LlmImageRequestPricing,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ResolvedRetryPolicy,
  StreamChunk,
} from "@deepseek-ai/dsh-llm"
import type {
  DiscoveredModel,
  NativeCompletion,
  NativeDeps,
  PreparedRequest,
  ReplayProjection,
  RunNative,
} from "./contract"
import { NativeFailure } from "./errors"
import { ChunkTranslator, failureChunk } from "./response/chunks"

export interface AdapterDeps {
  prepare(options: GenerateOptions): Promise<PreparedRequest>
  run: RunNative
  discover(deps: NativeDeps): Promise<readonly DiscoveredModel[]>
  modelInfo(provider: string, model: string): LlmResolvedModelInfo
  /** The target request assembly asks of the attachment service. */
  imageTarget(image: ImageAttachmentRef): ImageRequestTarget
  projectionOf(content: readonly ContentBlock[]): ReplayProjection
  native: NativeDeps
  /** Told the message of a failed model discovery, and `undefined` once one succeeds. */
  reportDiscovery(error: string | undefined): void
  warn(message: string): void
}

interface Discovery {
  /** The settings the models were asked for. */
  key: string
  models: Promise<readonly DiscoveredModel[]>
}

/**
 * Serves one DSH model call by running the `claude` CLI once. DSH loads its own copy of the
 * `dsh-llm` package, so this class implements the adapter shape and does not extend the base class.
 */
export class ClaudeSubscriptionAdapter implements LlmAdapter {
  private discovery: Discovery | undefined

  constructor(private readonly deps: AdapterDeps) {}

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: "Claude Subscription" }
  }

  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined {
    return undefined
  }

  imageRequestPricing(_provider: string, _model: string): LlmImageRequestPricing | undefined {
    return undefined
  }

  imageRequestTarget(
    _provider: string,
    _model: string,
    image: ImageAttachmentRef,
  ): ImageRequestTarget {
    return this.deps.imageTarget(image)
  }

  async listModels(provider: string): Promise<LlmModelInfo[]> {
    const models = await this.discovered()
    return models.map((model) => this.modelRow(provider, model))
  }

  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.deps.modelInfo(provider, model))
  }

  async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk, void, void> {
    try {
      const prepared = await this.deps.prepare(options)
      yield* this.runPrepared(prepared, options.signal)
    } catch (error) {
      if (!(error instanceof NativeFailure)) throw error
      yield failureChunk(error, options.signal)
    }
  }

  private async *runPrepared(
    prepared: PreparedRequest,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<StreamChunk, void, void> {
    const translator = new ChunkTranslator({
      toolNames: prepared.toolNames,
      projectionOf: this.deps.projectionOf,
    })
    const events = this.deps.run(prepared, signal, this.deps.native)
    let completion: NativeCompletion | undefined
    try {
      while (completion === undefined) {
        const next = await events.next()
        if (next.done) completion = next.value
        else yield* translator.event(next.value)
      }
    } finally {
      // A `for await` loop would close the run but cannot read the value it returns.
      if (completion === undefined) await events.return(undefined as never)
    }
    this.warnIfUnrestored(completion)
    yield* translator.complete(completion)
  }

  private warnIfUnrestored(completion: NativeCompletion): void {
    if (completion.unrestored === null) return
    this.deps.warn(`The queried turn stayed as Claude Code built it: ${completion.unrestored}`)
  }

  private modelRow(provider: string, model: DiscoveredModel): LlmModelInfo {
    const { inputModalities } = this.deps.modelInfo(provider, model.id)
    return {
      provider,
      id: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
    }
  }

  private discovered(): Promise<readonly DiscoveredModel[]> {
    const key = JSON.stringify(this.deps.native.settings())
    if (this.discovery?.key === key) return this.discovery.models
    // Deferred so the entry is in place before the discovery can settle.
    const models = Promise.resolve().then(() => this.discover(key))
    this.discovery = { key, models }
    return models
  }

  private async discover(key: string): Promise<readonly DiscoveredModel[]> {
    try {
      const models = await this.deps.discover(this.deps.native)
      if (this.discovery?.key === key) this.deps.reportDiscovery(undefined)
      return models
    } catch (error) {
      // A failure is not kept, so the next call sees a login made in the meantime.
      if (this.discovery?.key === key) {
        this.discovery = undefined
        this.deps.reportDiscovery(error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  }
}
