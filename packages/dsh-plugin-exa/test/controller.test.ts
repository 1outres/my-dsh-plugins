import { describe, expect, it } from "vitest"
import {
  DEFAULT_CONFIG,
  formatDomains,
  normalizeConfig,
  parseDomains,
  SEARCH_CONTENTS,
  SEARCH_TYPES,
} from "../src/client/config"
import { ExaSettingsController, NUMBER_RULES } from "../src/client/controller"
import type {
  ConfigForm,
  ConfigFormSnapshot,
  CredentialInfo,
  CredentialsRemote,
  ExaConfig,
  WebConfig,
} from "../src/client/types"

interface Write {
  readonly kind: "set" | "unset"
  readonly field: string
  readonly value?: unknown
}

interface FakeForm<T> {
  readonly form: ConfigForm<T>
  readonly writes: Write[]
  setValue(value: Partial<T>): void
  setWritable(writable: boolean): void
  setStatus(status: ConfigFormSnapshot<T>["status"]): void
  refuseNextWrite(): void
}

function fakeForm<T extends object>(initial: T): FakeForm<T> {
  let value = { ...initial }
  let writable = true
  let status: ConfigFormSnapshot<T>["status"] = "ready"
  let refuse = false
  let revision = 1
  const listeners = new Set<() => void>()
  const writes: Write[] = []
  const notify = () => {
    revision += 1
    for (const listener of [...listeners]) listener()
  }
  const form: ConfigForm<T> = {
    getSnapshot: () => ({ status, value, revision, writable }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, next) => {
      if (refuse) {
        refuse = false
        return false
      }
      writes.push({ kind: "set", field, value: next })
      value = { ...value, [field]: next }
      notify()
      return true
    },
    unset: async (field) => {
      if (refuse) {
        refuse = false
        return false
      }
      writes.push({ kind: "unset", field })
      delete (value as Record<string, unknown>)[field]
      notify()
      return true
    },
  }
  return {
    form,
    writes,
    setValue: (next) => {
      value = { ...value, ...next }
      notify()
    },
    setWritable: (next) => {
      writable = next
      notify()
    },
    setStatus: (next) => {
      status = next
      notify()
    },
    refuseNextWrite: () => {
      refuse = true
    },
  }
}

interface DescribeCall {
  readonly kind: "describe"
  readonly refs: readonly string[]
}

interface SetCall {
  readonly kind: "set" | "unset"
  readonly ref: string
  readonly value?: string
}

type CredentialCall = DescribeCall | SetCall

interface FakeCredentials {
  readonly credentials: CredentialsRemote
  readonly calls: CredentialCall[]
  readonly state: Record<string, CredentialInfo>
  failSetWith?: { readonly code: string; readonly message: string }
  failDescribe?: boolean
}

function fakeCredentials(
  state: Record<string, CredentialInfo> = {
    EXA_API_KEY: { configured: false, writable: true },
  },
): FakeCredentials {
  const calls: CredentialCall[] = []
  const credentials: CredentialsRemote = {
    async describe(refs) {
      calls.push({ kind: "describe", refs: [...refs] })
      if (fake.failDescribe === true) throw new Error("the Host is offline")
      return {
        ok: true,
        value: Object.fromEntries(
          refs.map((ref) => [ref, fake.state[ref] ?? { configured: false, writable: true }]),
        ),
      }
    },
    async set(ref, value) {
      calls.push({ kind: "set", ref, value })
      if (fake.failSetWith !== undefined) return { ok: false, error: fake.failSetWith }
      fake.state[ref] = { configured: true, writable: true, source: "file" }
      return { ok: true, value: undefined }
    },
    async unset(ref) {
      calls.push({ kind: "unset", ref })
      if (fake.failSetWith !== undefined) return { ok: false, error: fake.failSetWith }
      fake.state[ref] = { configured: false, writable: true }
      return { ok: true, value: undefined }
    },
  }
  const fake = { calls, state, credentials } as FakeCredentials
  return fake
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

interface Harness {
  readonly form: FakeForm<ExaConfig>
  readonly webForm: FakeForm<WebConfig>
  readonly store: FakeCredentials
  readonly controller: ExaSettingsController
}

function harness(
  options: {
    config?: Partial<ExaConfig>
    web?: WebConfig
    state?: Record<string, CredentialInfo>
  } = {},
): Harness {
  const form = fakeForm<ExaConfig>({ ...DEFAULT_CONFIG, ...options.config })
  const webForm = fakeForm<WebConfig>(
    options.web ?? { searchProvider: "exa", fetchProvider: "exa" },
  )
  const store = fakeCredentials(options.state)
  const controller = new ExaSettingsController({
    form: form.form,
    webForm: webForm.form,
    credentials: store.credentials,
  })
  return { form, webForm, store, controller }
}

function writesOf(store: FakeCredentials): CredentialCall[] {
  return store.calls.filter((call) => call.kind !== "describe")
}

describe("normalizeConfig", () => {
  it("falls back to the schema defaults for missing fields", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it("keeps valid values and replaces invalid ones", () => {
    expect(
      normalizeConfig({
        apiKeyEnv: "MY_KEY",
        baseURL: "https://exa.test",
        searchType: "deep",
        searchContents: "text",
        searchMaxCharacters: 2000,
        includeDomains: ["a.test", "", " b.test "],
        excludeDomains: "nope" as never,
        fetchMaxCharacters: Number.NaN,
      }),
    ).toEqual({
      apiKeyEnv: "MY_KEY",
      baseURL: "https://exa.test",
      searchType: "deep",
      searchContents: "text",
      searchMaxCharacters: 2000,
      includeDomains: ["a.test", "b.test"],
      excludeDomains: [],
      fetchMaxCharacters: DEFAULT_CONFIG.fetchMaxCharacters,
    })
  })

  it("lists the choices the settings page offers", () => {
    expect(SEARCH_TYPES).toEqual(["auto", "lite", "deep-lite", "deep"])
    expect(SEARCH_CONTENTS).toEqual(["highlights", "text"])
  })
})

describe("domain text", () => {
  it("parses one domain per line and drops blank lines", () => {
    expect(parseDomains("a.test\n\n  b.test  \r\nc.test\n")).toEqual(["a.test", "b.test", "c.test"])
    expect(parseDomains("  \n\t\n")).toEqual([])
  })

  it("formats domains one per line", () => {
    expect(formatDomains(["a.test", "b.test"])).toBe("a.test\nb.test")
    expect(formatDomains([])).toBe("")
  })
})

describe("ExaSettingsController", () => {
  it("publishes the configuration, the provider selection and the key state", async () => {
    const h = harness({
      web: { searchProvider: "exa", fetchProvider: "http" },
      state: { EXA_API_KEY: { configured: true, writable: true, source: "env" } },
    })
    await flush()

    const snapshot = h.controller.getSnapshot()
    expect(snapshot.status).toBe("ready")
    expect(snapshot.writable).toBe(true)
    expect(snapshot.config).toEqual(DEFAULT_CONFIG)
    expect(snapshot.web).toEqual({ search: true, fetch: false })
    expect(snapshot.credential).toEqual({
      ref: "EXA_API_KEY",
      configured: true,
      writable: true,
      source: "env",
    })
  })

  it("re-reads the key state when the credential name changes", async () => {
    const h = harness()
    await flush()

    h.form.setValue({ apiKeyEnv: "MY_EXA_KEY" })
    await flush()

    const describes = h.store.calls.filter((call) => call.kind === "describe")
    expect(describes.at(-1)).toEqual({ kind: "describe", refs: ["MY_EXA_KEY"] })
    expect(h.controller.getSnapshot().credential.ref).toBe("MY_EXA_KEY")
  })

  it("writes a key and re-reads whether the Host now has one", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.saveKey("secret")).resolves.toBe(true)

    expect(writesOf(h.store)).toEqual([{ kind: "set", ref: "EXA_API_KEY", value: "secret" }])
    expect(h.controller.getSnapshot().credential.configured).toBe(true)
    expect(h.controller.getSnapshot().credential.error).toBeUndefined()
  })

  it("removes a key and re-reads the state", async () => {
    const h = harness({
      state: { EXA_API_KEY: { configured: true, writable: true, source: "file" } },
    })
    await flush()

    await expect(h.controller.removeKey()).resolves.toBe(true)

    expect(writesOf(h.store)).toEqual([{ kind: "unset", ref: "EXA_API_KEY" }])
    expect(h.controller.getSnapshot().credential.configured).toBe(false)
  })

  it("shows the failure text when a key call fails", async () => {
    const h = harness()
    h.store.failSetWith = { code: "credential/rejected", message: "The Host refused the key." }
    await flush()

    await expect(h.controller.saveKey("secret")).resolves.toBe(false)

    expect(h.controller.getSnapshot().credential.error).toBe("The Host refused the key.")
  })

  it("shows a read failure and disables key editing", async () => {
    const h = harness()
    await flush()
    h.store.failDescribe = true
    h.controller.refreshCredential("EXA_API_KEY")
    await flush()

    expect(h.controller.getSnapshot().credential.error).toBe("the Host is offline")
    expect(h.controller.getSnapshot().credential.writable).toBe(false)
  })

  it("accepts a valid number and clears its earlier error", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitNumber("searchMaxCharacters", "42")).resolves.toBe(false)
    expect(h.form.writes).toEqual([])
    expect(h.controller.getSnapshot().errors.searchMaxCharacters).toBe("invalidSearchMaxCharacters")

    await expect(h.controller.commitNumber("searchMaxCharacters", "20000")).resolves.toBe(true)
    expect(h.form.writes).toEqual([{ kind: "set", field: "searchMaxCharacters", value: 20000 }])
    expect(h.controller.getSnapshot().errors.searchMaxCharacters).toBeUndefined()
  })

  it("rejects a fractional or out-of-range number without writing", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitNumber("fetchMaxCharacters", "1.5")).resolves.toBe(false)
    await expect(h.controller.commitNumber("fetchMaxCharacters", "999")).resolves.toBe(false)
    await expect(h.controller.commitNumber("fetchMaxCharacters", "1000001")).resolves.toBe(false)

    expect(h.form.writes).toEqual([])
    expect(h.controller.getSnapshot().errors.fetchMaxCharacters).toBe("invalidFetchMaxCharacters")
  })

  it("clears a number when the field is left empty", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitNumber("fetchMaxCharacters", "   ")).resolves.toBe(true)

    expect(h.form.writes).toEqual([{ kind: "unset", field: "fetchMaxCharacters" }])
  })

  it("writes text fields trimmed and clears them when empty", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitText("baseURL", "  https://exa.test  ")).resolves.toBe(true)
    await expect(h.controller.commitText("baseURL", "   ")).resolves.toBe(true)

    expect(h.form.writes).toEqual([
      { kind: "set", field: "baseURL", value: "https://exa.test" },
      { kind: "unset", field: "baseURL" },
    ])
  })

  it("rejects an invalid base URL or credential name without writing", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitText("baseURL", "exa.test")).resolves.toBe(false)
    await expect(h.controller.commitText("apiKeyEnv", "1BAD")).resolves.toBe(false)

    expect(h.form.writes).toEqual([])
    expect(h.controller.getSnapshot().errors.baseURL).toBe("invalidBaseURL")
    expect(h.controller.getSnapshot().errors.apiKeyEnv).toBe("invalidApiKeyEnv")
  })

  it("writes domains as an array and clears an empty list", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitDomains("includeDomains", "a.test\n\n b.test ")).resolves.toBe(
      true,
    )
    await expect(h.controller.commitDomains("excludeDomains", "\n  \n")).resolves.toBe(true)

    expect(h.form.writes).toEqual([
      { kind: "set", field: "includeDomains", value: ["a.test", "b.test"] },
      { kind: "unset", field: "excludeDomains" },
    ])
  })

  it("writes select values", async () => {
    const h = harness()
    await flush()

    await expect(h.controller.commitSelect("searchType", "deep")).resolves.toBe(true)
    await expect(h.controller.commitSelect("searchContents", "text")).resolves.toBe(true)

    expect(h.form.writes).toEqual([
      { kind: "set", field: "searchType", value: "deep" },
      { kind: "set", field: "searchContents", value: "text" },
    ])
  })

  it("reports a refused write", async () => {
    const h = harness()
    await flush()
    h.form.refuseNextWrite()

    await expect(h.controller.commitSelect("searchType", "lite")).resolves.toBe(false)

    expect(h.controller.getSnapshot().writeError).toBe(true)
  })

  it("re-reads the key only for the reference it watches", async () => {
    const h = harness()
    await flush()
    const before = h.store.calls.filter((call) => call.kind === "describe").length

    h.controller.refreshCredential("OTHER_KEY")
    await flush()
    expect(h.store.calls.filter((call) => call.kind === "describe")).toHaveLength(before)

    h.controller.refreshCredential("EXA_API_KEY")
    await flush()
    expect(h.store.calls.filter((call) => call.kind === "describe")).toHaveLength(before + 1)
  })

  it("notifies subscribers and stops after dispose", async () => {
    const h = harness()
    await flush()
    let notifications = 0
    const off = h.controller.subscribe(() => {
      notifications += 1
    })

    await h.controller.commitSelect("searchType", "deep")
    expect(notifications).toBeGreaterThan(0)

    off()
    h.controller.dispose()
    const count = notifications
    await h.controller.commitSelect("searchType", "lite")
    expect(notifications).toBe(count)
  })
})

describe("number rules", () => {
  it("matches the schema ranges", () => {
    expect(NUMBER_RULES.searchMaxCharacters).toEqual({
      min: 100,
      max: 20000,
      error: "invalidSearchMaxCharacters",
    })
    expect(NUMBER_RULES.fetchMaxCharacters).toEqual({
      min: 1000,
      max: 1000000,
      error: "invalidFetchMaxCharacters",
    })
  })
})
