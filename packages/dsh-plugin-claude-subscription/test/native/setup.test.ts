import { existsSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { CONTEXT_WINDOWS, PICKER_ROUTES } from "../../src/catalog"
import type { DiscoveredModel } from "../../src/contract"
import { FailureCode, NativeFailure } from "../../src/errors"
import { discoverModels, setupStatus } from "../../src/native/setup"
import { FAKE_RELAY_URL } from "../support/fake-relay"
import {
  type FakeClaudeScenario,
  type HarnessOptions,
  type NativeHarness,
  nativeHarness,
} from "../support/native-harness"

const PRO = {
  auth: { loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" },
  account: { subscriptionType: "Claude Pro" },
}

const PINNED_PICKER = [
  {
    value: "sonnet[1m]",
    resolvedModel: "claude-sonnet-5[1m]",
    displayName: "Sonnet 5 (1M context)",
    description: "Sonnet 5 for long sessions",
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    description: "Opus 5.5 · Best for everyday, complex tasks",
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5.5 with 1M context · Draws from usage credits · $4/$20 per Mtok",
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
]

// Models the pinned table has never heard of, fictitious on purpose: a plain and [1m] pair behind
// the CLI's own `opus` alias, a plain-only id, and a [1m]-only id.
const UNPINNED_PICKER = [
  {
    value: "opus",
    resolvedModel: "claude-opus-9",
    displayName: "Opus",
    description: "Opus 9 · Best for everyday, complex tasks",
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-9[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 9 with 1M context · Draws from usage credits · $5/$25 per Mtok",
  },
  {
    value: "claude-sonnet-5-9",
    resolvedModel: "claude-sonnet-5-9",
    displayName: "Sonnet",
    description: "Sonnet 5.9 · Efficient for routine tasks",
  },
  {
    value: "claude-fable-9[1m]",
    resolvedModel: "claude-fable-9[1m]",
    displayName: "Fable",
    description: "Fable 9 · Most capable for your hardest tasks",
  },
  // An alias row the CLI leaves unresolved is not a model.
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 9 · Best for everyday, complex tasks",
  },
]

const MYTHOS = {
  value: "claude-mythos-5-1",
  resolvedModel: "claude-mythos-5-1",
  displayName: "Mythos 5.1",
  description: "",
}
const SERVED_OPUS = {
  value: "opus",
  resolvedModel: "claude-opus-5-5",
  displayName: "Opus 5.5",
  description: "For complex work and everyday tasks",
}
const MYTHOS_DEFAULT = {
  value: "default",
  resolvedModel: "claude-mythos-5-1",
  displayName: "Default (recommended)",
  description: "Mythos 5.1",
}
const SERVED_FABLE = [
  {
    value: "fable",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable 5.1",
    description: "For your toughest challenges",
  },
  {
    value: "claude-fable-5",
    resolvedModel: "claude-fable-5",
    displayName: "Fable 5",
    description: "Most capable for your hardest and longest-running tasks",
  },
]
// What a CLI started with the quiet traffic flags offers: only each family's current model.
const PRIVACY_PICKER = [
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    description: "Opus 5.5 · Best for everyday, complex tasks",
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5.5 with 1M context",
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks",
  },
  {
    value: "fable",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5.1 · Most capable for your hardest tasks",
  },
  // The undated alias id must land on the dated pinned route, not on a second row.
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
]

function byId(models: readonly DiscoveredModel[]): Record<string, DiscoveredModel> {
  return Object.fromEntries(models.map((model) => [model.id, model]))
}

function isUnpinned(model: DiscoveredModel): boolean {
  return model.description?.includes("unpinned") === true
}

describe("setup probes", () => {
  const harnesses: NativeHarness[] = []

  function harness(scenario: FakeClaudeScenario, options: HarnessOptions = {}): NativeHarness {
    const created = nativeHarness({ scenario: { ...PRO, ...scenario }, ...options })
    harnesses.push(created)
    return created
  }

  function discover(models: unknown, scenario: FakeClaudeScenario = {}) {
    const created = harness({ models, ...scenario })
    return discoverModels(created.deps)
  }

  async function failureOf(promise: Promise<unknown>): Promise<NativeFailure> {
    const outcome = await promise.then(
      () => undefined,
      (error: unknown) => error,
    )
    if (outcome instanceof NativeFailure) return outcome
    throw new Error(`expected a NativeFailure, got ${String(outcome)}`)
  }

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((created) => created.dispose()))
  })

  describe("setupStatus", () => {
    it("reports the login and the plan from the CLI", async () => {
      const status = await setupStatus(harness({}).deps)
      expect(status).toEqual({ installed: true, loggedIn: true, subscriptionType: "Claude Pro" })
    })

    it.each([
      ["pro", "Claude Pro"],
      ["max_5x", "Claude Max 5x"],
      ["Claude Max", "Claude Max"],
    ])("labels the plan %j as %j", async (raw, label) => {
      const created = harness({ auth: { loggedIn: true, subscriptionType: raw } })
      expect((await setupStatus(created.deps)).subscriptionType).toBe(label)
    })

    it("says how to log in when logged out", async () => {
      const status = await setupStatus(harness({ auth: { loggedIn: false } }).deps)
      expect(status.installed).toBe(true)
      expect(status.loggedIn).toBe(false)
      expect(status.detail).toContain("claude auth login")
    })

    it("says how to install when the CLI is missing", async () => {
      const created = nativeHarness({ command: "/nonexistent/claude" })
      harnesses.push(created)
      const status = await setupStatus(created.deps)
      expect(status.installed).toBe(false)
      expect(status.loggedIn).toBe(false)
      expect(status.detail?.toLowerCase()).toContain("install")
    })

    it("does not guess a login from output it cannot read", async () => {
      const failure = await failureOf(
        setupStatus(
          harness({ authRaw: "mise WARN tool not activated", authScript: [{ err: "shim noise" }] })
            .deps,
        ),
      )
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("mise WARN")
      expect(failure.message).toContain("shim noise")
    })

    it("raises aborted when cancelled", async () => {
      const controller = new AbortController()
      controller.abort()
      const failure = await failureOf(setupStatus(harness({}).deps, controller.signal))
      expect(failure.code).toBe(FailureCode.aborted)
    })

    it("carries the login identity and the config directory", async () => {
      const created = harness({}, { settings: { claudeConfigDir: "/profile-login" } })
      await setupStatus(created.deps)
      const [invocation] = created.invocations()
      expect(invocation?.argv).toEqual(["auth", "status"])
      expect(invocation?.env.CLAUDE_CONFIG_DIR).toBe("/profile-login")
      expect(invocation?.env.USER).toBeTruthy()
    })
  })

  describe("discoverModels", () => {
    it("deduplicates picker rows to one route and names the model", async () => {
      const models = await discover(PINNED_PICKER)
      expect(models.slice(0, 3).map((model) => model.id)).toEqual([
        "claude-sonnet-5[1m]",
        "claude-opus-5-5[1m]",
        "claude-haiku-4-5-20251001",
      ])
      expect(models.slice(0, 3).map((model) => model.name)).toEqual([
        "Sonnet 5 (1M context)",
        "Opus 5.5",
        "Haiku 4.5",
      ])
      expect(models[1]?.description).toBe("usage credits")
      expect(models[2]?.description).toBeUndefined()
    })

    it("sends only `initialize`, with a handshake argv that holds no turn", async () => {
      const created = harness({ models: PINNED_PICKER })
      await discoverModels(created.deps)
      const handshake = created.invocations()[1]
      expect(handshake?.argv).toEqual([
        "-p",
        "--model",
        "sonnet",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--disable-slash-commands",
        "--no-session-persistence",
      ])
      expect(created.frames()).toEqual([])
    })

    it("runs the probes in a temp directory that it removes", async () => {
      const created = harness({ models: PINNED_PICKER })
      await discoverModels(created.deps)
      for (const invocation of created.invocations()) {
        expect(existsSync(invocation.cwd)).toBe(false)
      }
    })

    it("reads an entitled model from the account's picker without the relay", async () => {
      const created = harness({
        models: PINNED_PICKER,
        served: [MYTHOS_DEFAULT, ...PINNED_PICKER, MYTHOS],
      })
      const models = await discoverModels(created.deps)
      expect(models.filter((model) => model.id === "claude-mythos-5-1[1m]")).toHaveLength(1)
      expect(byId(models)["claude-mythos-5-1[1m]"]?.name).toBe("Mythos 5.1")
      expect(byId(models)["claude-mythos-5-1[1m]"]?.description).toBeUndefined()
      expect(created.relay.created).toHaveLength(0)
      for (const invocation of created.invocations()) {
        expect(invocation.env.ANTHROPIC_BASE_URL).toBeUndefined()
      }
    })

    it("takes the name from a served row's displayName", async () => {
      const models = await discover(PINNED_PICKER, { served: [SERVED_OPUS, MYTHOS] })
      expect(byId(models)["claude-opus-5-5[1m]"]?.name).toBe("Opus 5.5")
      expect(byId(models)["claude-mythos-5-1[1m]"]?.name).toBe("Mythos 5.1")
    })

    // The generic list's default row, as the CLI really prints it.
    const GENERIC_DEFAULT = {
      value: "default",
      resolvedModel: "claude-opus-5-5",
      displayName: "Default (recommended)",
      description: "Use the default model (currently Opus 5.5) · $4/$20 per Mtok",
    }

    it("names a route from its own row, not from the default row before it", async () => {
      const models = await discover([GENERIC_DEFAULT, PINNED_PICKER[1]])
      expect(models[0]?.id).toBe("claude-opus-5-5[1m]")
      expect(models[0]?.name).toBe("Opus 5.5")
    })

    it("keeps the default row's text when no other row names the route", async () => {
      const models = await discover([GENERIC_DEFAULT])
      expect(byId(models)["claude-opus-5-5[1m]"]?.name).toBe(
        "Use the default model (currently Opus 5.5)",
      )
    })

    it("does not offer an access-gated model the picker omits", async () => {
      const models = await discover(PINNED_PICKER, { served: PINNED_PICKER })
      expect(models.some((model) => model.id.includes("mythos"))).toBe(false)
    })

    it.each([
      ["ANTHROPIC_BASE_URL", "https://gateway.example.com"],
      ["CLAUDE_CODE_USE_VERTEX", "1"],
    ])("stays behind the relay when %s is inherited", async (name, value) => {
      const created = harness(
        { models: PINNED_PICKER, served: [...PINNED_PICKER, MYTHOS] },
        { env: { [name]: value } },
      )
      const models = await discoverModels(created.deps)
      expect(models.some((model) => model.id.includes("mythos"))).toBe(false)
      expect(created.invocations()[1]?.env.ANTHROPIC_BASE_URL).toBe(FAKE_RELAY_URL)
      expect(created.relay.options[0]?.upstream).toBe("https://api.anthropic.com")
      expect(created.relay.last().closed).toBe(true)
    })

    it("treats a request behind the relay as a failed handshake", async () => {
      const created = harness(
        { models: PINNED_PICKER },
        { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9" }, relay: { used: true } },
      )
      const failure = await failureOf(discoverModels(created.deps))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(created.relay.last().closed).toBe(true)
    })

    it.each([
      ["Claude Pro", "usage credits"],
      ["Claude Max", undefined],
      ["Claude Ultra", undefined],
      ["Claude Team", "usage credits on standard seats"],
      ["Claude Enterprise", "usage credits on standard seats"],
    ])("applies the Fable billing rule on %s", async (plan, note) => {
      const models = await discover(PINNED_PICKER, {
        account: { subscriptionType: plan },
        served: SERVED_FABLE,
      })
      expect(byId(models)["claude-fable-5-1[1m]"]?.description).toBe(note)
      expect(byId(models)["claude-fable-5"]?.description).toBe(
        note === undefined ? "unpinned" : `${note} · unpinned`,
      )
    })

    it("keeps the version in the name of a generic 1M row", async () => {
      const models = await discover([PINNED_PICKER[2]])
      expect(byId(models)["claude-opus-5-5[1m]"]?.name).toBe("Opus 5.5 with 1M context")
    })

    it("lists every advertised model, pinned or not", async () => {
      const pinned = await discover(PINNED_PICKER)
      const models = await discover([...PINNED_PICKER, ...UNPINNED_PICKER])
      expect(models.filter((model) => !isUnpinned(model))).toEqual(pinned)
      const fresh = byId(models.filter(isUnpinned))
      expect(Object.keys(fresh).sort()).toEqual([
        "claude-fable-9[1m]",
        "claude-opus-9[1m]",
        "claude-sonnet-5-9",
      ])
      expect(fresh["claude-opus-9[1m]"]?.name).toBe("Opus 9")
      expect(fresh["claude-sonnet-5-9"]?.name).toBe("Sonnet 5.9")
      expect(fresh["claude-fable-9[1m]"]?.name).toBe("Fable 9")
      expect(fresh["claude-opus-9[1m]"]?.description).toBe("usage credits · unpinned")
      expect(fresh["claude-sonnet-5-9"]?.description).toBe("unpinned")
      expect(fresh["claude-fable-9[1m]"]?.description).toBe("unpinned")
    })

    it("appends the pinned routes the picker omits, after the advertised rows", async () => {
      const models = await discover([...PINNED_PICKER, ...UNPINNED_PICKER])
      const ids = models.map((model) => model.id)
      for (const route of PICKER_ROUTES) expect(ids).toContain(route)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).not.toContain("claude-mythos-5-1[1m]")
      const announced = ["claude-sonnet-5[1m]", "claude-opus-5-5[1m]", "claude-haiku-4-5-20251001"]
      const appended = PICKER_ROUTES.filter((route) => !announced.includes(route))
      expect(ids.slice(-appended.length)).toEqual(appended)
      const rows = byId(models)
      expect(rows["claude-opus-4-8[1m]"]?.name).toBe("Opus 4.8")
      expect(rows["claude-opus-5[1m]"]?.name).toBe("Opus 5")
      expect(rows["claude-fable-5-1[1m]"]?.description).toBe("usage credits")
    })

    it("unions a picker shrunk by the quiet flags with the pinned table", async () => {
      const models = await discover(PRIVACY_PICKER)
      const ids = models.map((model) => model.id)
      const advertised = [
        "claude-opus-5-5[1m]",
        "claude-sonnet-5[1m]",
        "claude-fable-5-1[1m]",
        "claude-haiku-4-5-20251001",
      ]
      expect(ids.slice(0, advertised.length)).toEqual(advertised)
      expect(new Set(ids)).toEqual(new Set([...advertised, ...PICKER_ROUTES]))
      expect(ids.length).toBe(new Set(ids).size)
      expect(ids.some((id) => id.startsWith("claude-opus-4-6"))).toBe(false)
      for (const id of ids) expect(CONTEXT_WINDOWS).toHaveProperty(id.replace("[1m]", ""))
    })

    it("raises invalidCredential with the login hint when logged out", async () => {
      const created = harness({ auth: { loggedIn: false }, models: [] })
      const failure = await failureOf(discoverModels(created.deps))
      expect(failure.code).toBe(FailureCode.invalidCredential)
      expect(failure.failure.status).toBe(401)
      expect(failure.message).toContain("claude auth login")
      expect(created.invocations()).toHaveLength(1)
    })

    it("raises claudeCodeMissing when the CLI is missing", async () => {
      const created = nativeHarness({ command: "/nonexistent/claude" })
      harnesses.push(created)
      const failure = await failureOf(discoverModels(created.deps))
      expect(failure.code).toBe(FailureCode.claudeCodeMissing)
      expect(failure.failure.status).toBe(503)
    })

    it.each<[string, FakeClaudeScenario]>([
      ["no answer", { handshakeRaw: "" }],
      ["a broken JSON row", { handshakeRaw: "{not json" }],
      ["an empty picker", { models: [] }],
      ["a picker that is no list", { models: "many" }],
      ["only alias rows", { models: [{ value: "default", displayName: "Default" }] }],
      ["rows that are no objects", { models: ["claude-opus-5-5"] }],
    ])("raises nativeProtocol on %s, with no pinned rows", async (_case, scenario) => {
      const created = harness({
        handshakeScript: [{ err: "handshake stderr" }],
        ...scenario,
      })
      const failure = await failureOf(discoverModels(created.deps))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("handshake stderr")
    })

    it("raises aborted when cancelled during the handshake", async () => {
      const controller = new AbortController()
      const created = nativeHarness({
        scenario: {
          ...PRO,
          models: PINNED_PICKER,
          handshakeScript: [{ sleepMs: 30_000 }],
        },
      })
      harnesses.push(created)
      const pending = discoverModels(created.deps, controller.signal)
      const abortSoon = setInterval(() => {
        if (created.invocations().length === 2) controller.abort()
      }, 5)
      const failure = await failureOf(pending)
      clearInterval(abortSoon)
      expect(failure.code).toBe(FailureCode.aborted)
    })

    describe("child environment", () => {
      async function childEnvs(options: HarnessOptions = {}): Promise<Record<string, string>[]> {
        const created = harness({ models: PINNED_PICKER }, options)
        await discoverModels(created.deps)
        const invocations = created.invocations()
        expect(invocations).toHaveLength(2)
        return invocations.map((invocation) => invocation.env)
      }

      const QUIET = [
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
        "DISABLE_TELEMETRY",
        "DISABLE_ERROR_REPORTING",
      ]

      it("keeps telemetry on by default, on both probes", async () => {
        for (const env of await childEnvs()) {
          for (const name of QUIET) expect(env[name]).toBeUndefined()
          expect(env.DISABLE_AUTOUPDATER).toBe("1")
          expect(env.DISABLE_FEEDBACK_COMMAND).toBe("1")
          expect(env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE).toBe("1")
        }
      })

      it("turns the quiet flags on when the setting is off", async () => {
        const envs = await childEnvs({ settings: { claudeCodeTelemetry: false } })
        for (const env of envs) {
          for (const name of QUIET) expect(env[name]).toBe("1")
        }
      })

      it("never strips a user's own opt-out", async () => {
        const envs = await childEnvs({ env: { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" } })
        for (const env of envs) {
          expect(env.DISABLE_TELEMETRY).toBe("1")
          expect(env.DO_NOT_TRACK).toBe("1")
        }
      })

      it("runs under the harness's own name", async () => {
        for (const env of await childEnvs({ env: { CLAUDE_CODE_ENTRYPOINT: "sdk-py" } })) {
          expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("deepseek-harness")
          expect(env.CLAUDE_CODE_DISABLE_ARTIFACT).toBe("1")
        }
      })

      it("passes the chosen config directory", async () => {
        for (const env of await childEnvs({ settings: { claudeConfigDir: "/profile-login" } })) {
          expect(env.CLAUDE_CONFIG_DIR).toBe("/profile-login")
        }
      })

      it("reads settings on every probe", async () => {
        const created = harness({ models: PINNED_PICKER })
        await discoverModels(created.deps)
        created.settings = { ...created.settings, claudeConfigDir: "/changed" }
        await discoverModels(created.deps)
        const dirs = created.invocations().map((invocation) => invocation.env.CLAUDE_CONFIG_DIR)
        expect(dirs).toEqual([undefined, undefined, "/changed", "/changed"])
      })
    })
  })
})
