import { type ComponentType, createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "../src/client/config"
import { apply, inject } from "../src/client/index"
import type {
  ClientContext,
  ConfigForm,
  ConfigFormSnapshot,
  CredentialInfo,
  CredentialsRemote,
  ExaConfig,
  SlotRegistration,
  WebConfig,
} from "../src/client/types"

interface FakeForm<T> {
  readonly form: ConfigForm<T>
  setValue(value: Partial<T>): void
}

function fakeForm<T extends object>(initial: T): FakeForm<T> {
  let value = { ...initial }
  let revision = 1
  const listeners = new Set<() => void>()
  const notify = () => {
    revision += 1
    for (const listener of [...listeners]) listener()
  }
  return {
    form: {
      getSnapshot: (): ConfigFormSnapshot<T> => ({
        status: "ready",
        value,
        revision,
        writable: true,
      }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: async (field, next) => {
        value = { ...value, [field]: next }
        notify()
        return true
      },
      unset: async (field) => {
        delete (value as Record<string, unknown>)[field]
        notify()
        return true
      },
    },
    setValue: (next) => {
      value = { ...value, ...next }
      notify()
    },
  }
}

interface CredentialCall {
  readonly kind: "describe" | "set" | "unset"
  readonly ref: string
}

interface FakeCredentials {
  readonly credentials: CredentialsRemote
  readonly calls: CredentialCall[]
  readonly state: Record<string, CredentialInfo>
}

function fakeCredentials(
  state: Record<string, CredentialInfo> = {
    EXA_API_KEY: { configured: false, writable: true },
  },
  describeFailure?: { readonly code: string; readonly message: string },
): FakeCredentials {
  const calls: CredentialCall[] = []
  const credentials: CredentialsRemote = {
    async describe(refs) {
      for (const ref of refs) calls.push({ kind: "describe", ref })
      if (describeFailure !== undefined) return { ok: false, error: describeFailure }
      return {
        ok: true,
        value: Object.fromEntries(
          refs.map((ref) => [ref, state[ref] ?? { configured: false, writable: true }]),
        ),
      }
    },
    async set(ref) {
      calls.push({ kind: "set", ref })
      state[ref] = { configured: true, writable: true, source: "file" }
      return { ok: true, value: undefined }
    },
    async unset(ref) {
      calls.push({ kind: "unset", ref })
      state[ref] = { configured: false, writable: true }
      return { ok: true, value: undefined }
    },
  }
  return { credentials, calls, state }
}

interface Harness {
  readonly ctx: ClientContext
  readonly registrations: { spec: SlotRegistration; component: unknown }[]
  readonly served: string[][]
  readonly slotKeys: string[]
  readonly dictionaries: [string, Record<string, Record<string, string>>][]
  readonly store: FakeCredentials
  readonly emitCredentialUpdate: (ref: string) => void
  readonly exaForm: FakeForm<ExaConfig>
  readonly webForm: FakeForm<WebConfig>
  dispose(): void
}

function harness(
  options: {
    web?: WebConfig
    state?: Record<string, CredentialInfo>
    describeFailure?: { readonly code: string; readonly message: string }
  } = {},
): Harness {
  const exaForm = fakeForm<ExaConfig>({ ...DEFAULT_CONFIG })
  const webForm = fakeForm<WebConfig>(
    options.web ?? { searchProvider: "exa", fetchProvider: "exa" },
  )
  const store = fakeCredentials(options.state, options.describeFailure)
  const registrations: { spec: SlotRegistration; component: unknown }[] = []
  const served: string[][] = []
  const slotKeys: string[] = []
  const dictionaries: [string, Record<string, Record<string, string>>][] = []
  const disposers: (() => void)[] = []
  let credentialListener: ((ref: string) => void) | undefined

  const t = (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`
  const ctx = {
    effect(run: () => (() => void) | undefined) {
      const dispose = run()
      if (dispose !== undefined) disposers.push(dispose)
    },
    slots: {
      inject(_key: string, register: () => () => void) {
        return register()
      },
      register(spec: SlotRegistration, component: unknown) {
        slotKeys.push(spec.name)
        registrations.push({ spec, component })
        return () => {}
      },
    },
    locale: {
      register(namespace: string, dicts: Record<string, Record<string, string>>) {
        dictionaries.push([namespace, dicts])
        return () => {}
      },
      bind() {
        return t
      },
    },
    configForms: {
      get<T>(namespace: string) {
        return (namespace === "web" ? webForm.form : exaForm.form) as unknown as ConfigForm<T>
      },
      whileServed(namespaces: readonly string[], register: () => () => void) {
        served.push([...namespaces])
        return register()
      },
    },
    remote: {
      credentials: store.credentials,
      $on(_event: string, listener: (ref: string) => void) {
        credentialListener = listener
        return () => {
          credentialListener = undefined
        }
      },
    },
  }

  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    served,
    slotKeys,
    dictionaries,
    store,
    exaForm,
    webForm,
    emitCredentialUpdate: (ref) => credentialListener?.(ref),
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

function describes(store: FakeCredentials): CredentialCall[] {
  return store.calls.filter((call) => call.kind === "describe")
}

let harnesses: Harness[] = []

beforeEach(() => {
  harnesses = []
})

afterEach(() => {
  for (const item of harnesses) item.dispose()
  vi.unstubAllGlobals()
})

describe("exa client half", () => {
  it("declares the services the page needs", () => {
    expect(inject).toEqual(["slots", "locale", "configForms", "remote", "remote.credentials"])
  })

  it("registers dictionaries and the settings section while the exa namespace is served", () => {
    const h = harness()
    harnesses.push(h)

    apply(h.ctx)

    expect(h.dictionaries.map(([namespace]) => namespace)).toEqual(["exa"])
    const [entry] = Object.values(h.dictionaries[0]?.[1] ?? {})
    expect(entry).toBeDefined()
    expect(h.served).toEqual([["exa"]])
    expect(h.slotKeys).toEqual(["settings.section"])
    const registration = h.registrations[0]?.spec
    expect(registration).toMatchObject({
      name: "settings.section",
      id: "exa",
      locale: "exa",
    })
  })

  it("reads the key state for the configured reference", async () => {
    const h = harness()
    harnesses.push(h)

    apply(h.ctx)
    await flush()

    expect(describes(h.store)).toEqual([{ kind: "describe", ref: "EXA_API_KEY" }])
  })

  it("re-reads the key when the reference changes", async () => {
    const h = harness()
    harnesses.push(h)
    apply(h.ctx)
    await flush()

    h.exaForm.setValue({ apiKeyEnv: "MY_EXA_KEY" })
    await flush()

    expect(describes(h.store).at(-1)).toEqual({ kind: "describe", ref: "MY_EXA_KEY" })
  })

  it("re-reads after a credential update for the same reference", async () => {
    const h = harness()
    harnesses.push(h)
    apply(h.ctx)
    await flush()
    const before = describes(h.store).length

    h.emitCredentialUpdate("OTHER_KEY")
    await flush()
    expect(describes(h.store)).toHaveLength(before)

    h.emitCredentialUpdate("EXA_API_KEY")
    await flush()
    expect(describes(h.store)).toHaveLength(before + 1)
  })

  it("stops listening after dispose", async () => {
    const h = harness()
    apply(h.ctx)
    await flush()
    const before = describes(h.store).length

    h.dispose()
    h.emitCredentialUpdate("EXA_API_KEY")
    await flush()

    expect(describes(h.store)).toHaveLength(before)
  })

  it("renders whether web search and fetch use Exa", async () => {
    const h = harness({ web: { searchProvider: "exa", fetchProvider: "http" } })
    harnesses.push(h)
    apply(h.ctx)
    await flush()

    const component = h.registrations[0]?.component as ComponentType
    const html = renderToStaticMarkup(createElement(component))

    expect(html).toContain("title")
    expect(html).toContain("statusSearch")
    expect(html).toContain("statusOn")
    expect(html).toContain("statusOff")
    expect(html).toContain("apiKeyUnset")
  })

  it("renders the source of a configured key", async () => {
    const h = harness({
      state: { EXA_API_KEY: { configured: true, writable: true, source: "env" } },
    })
    harnesses.push(h)
    apply(h.ctx)
    await flush()

    const component = h.registrations[0]?.component as ComponentType
    const html = renderToStaticMarkup(createElement(component))

    expect(html).toContain("apiKeySet:")
    expect(html).toContain("env")
    expect(html).toContain("removeKey")
  })

  it("renders the credential read failure text", async () => {
    const h = harness({
      describeFailure: { code: "gateway/internal", message: "the Host is offline" },
    })
    harnesses.push(h)
    apply(h.ctx)
    await flush()

    const component = h.registrations[0]?.component as ComponentType
    const html = renderToStaticMarkup(createElement(component))

    expect(html).toContain("the Host is offline")
    expect(html).not.toContain("apiKeyUnset")
  })

  it("disables the key input when the Host cannot write the credential", async () => {
    const h = harness({
      state: { EXA_API_KEY: { configured: true, writable: false, source: "env" } },
    })
    harnesses.push(h)
    apply(h.ctx)
    await flush()

    const component = h.registrations[0]?.component as ComponentType
    const html = renderToStaticMarkup(createElement(component))

    expect(html).toContain("apiKeyEnvironment")
    expect(html).not.toContain("removeKey")
  })
})
