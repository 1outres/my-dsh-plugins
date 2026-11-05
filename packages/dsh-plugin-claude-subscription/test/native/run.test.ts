import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterEach, describe, expect, it } from "vitest"
import type { NativeBlock, ToolManifestEntry } from "../../src/contract"
import { FailureCode, NativeFailure } from "../../src/errors"
import { runNative } from "../../src/native/run"
import { sharedWorkdir } from "../../src/native/workdir"
import { CLEAN_RELAY, capturedMessage, FAKE_RELAY_URL } from "../support/fake-relay"
import {
  cleanAnswer,
  drainRun,
  eventually,
  type FakeClaudeStep,
  type HarnessOptions,
  type NativeHarness,
  nativeErrorAnswer,
  nativeHarness,
  preparedRequest,
  processAlive,
  REPLAYED_HISTORY,
  userFrame,
} from "../support/native-harness"

const QUIET = [
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
]
const USAGE = { input_tokens: 3, output_tokens: 2 }
const STOP: FakeClaudeStep = { out: { type: "stream_event", event: { type: "message_stop" } } }

describe("runNative", () => {
  const harnesses: NativeHarness[] = []

  function harness(options: HarnessOptions = {}): NativeHarness {
    const created = nativeHarness({ relay: CLEAN_RELAY, ...options })
    harnesses.push(created)
    return created
  }

  function clean(options: HarnessOptions = {}): NativeHarness {
    return harness({
      scenario: { script: [...cleanAnswer(), { exit: 0 }] },
      ...options,
    })
  }

  async function failureOf(promise: Promise<unknown>): Promise<NativeFailure> {
    const outcome = await promise.then(
      () => undefined,
      (error: unknown) => error,
    )
    if (outcome instanceof NativeFailure) return outcome
    throw new Error(`expected a NativeFailure, got ${String(outcome)}`)
  }

  function run(created: NativeHarness, request = preparedRequest(), signal?: AbortSignal) {
    return drainRun(runNative(request, signal, created.deps))
  }

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((created) => created.dispose()))
  })

  describe("argv", () => {
    it("passes the full command line", async () => {
      const created = clean()
      await run(created)
      const [invocation] = created.invocations()
      const [files] = created.files()
      const directory = files?.directory ?? ""
      expect(invocation?.argv).toEqual([
        "-p",
        "--model",
        "claude-sonnet-5-5[1m]",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--system-prompt-file",
        join(directory, "system.md"),
        "--settings",
        join(directory, "settings.json"),
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--max-turns",
        "1",
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
        "--mcp-config",
        JSON.stringify({
          mcpServers: {
            dsh: {
              command: process.execPath,
              args: ["/fixture/inert-mcp.js", join(directory, "tools.json")],
            },
          },
        }),
        "--session-id",
        "11111111-1111-4111-8111-111111111111",
      ])
    })

    it("adds --effort when the request sets one", async () => {
      const created = clean()
      await run(created, preparedRequest({ effort: "low" }))
      const argv = created.invocations()[0]?.argv ?? []
      expect(argv.slice(argv.indexOf("--effort"), argv.indexOf("--effort") + 2)).toEqual([
        "--effort",
        "low",
      ])
    })

    it("spawns through the seam with the agreed stdio", async () => {
      const created = clean()
      await run(created)
      const spec = created.subprocess.spawned[0]?.spec
      expect(spec?.stdio).toEqual({
        stdin: "pipe",
        stdout: "pipe",
        stderr: { maxBytes: 16384 },
      })
      expect(spec?.graceMs).toBeGreaterThan(0)
    })
  })

  describe("request files", () => {
    it("writes the system prompt, the extra body and the manifest", async () => {
      const created = clean()
      const manifest: ToolManifestEntry[] = [
        { name: "probe", description: "TAIL", inputSchema: { type: "object", properties: {} } },
      ]
      const extraBody = { tools: [{ name: "mcp__dsh__probe" }], output_config: { effort: "low" } }
      await run(created, preparedRequest({ system: "S".repeat(5000), manifest, extraBody }))
      const [files] = created.files()
      expect(files?.system).toBe("S".repeat(5000))
      expect(JSON.parse(files?.settings.env.CLAUDE_CODE_EXTRA_BODY ?? "{}")).toEqual(extraBody)
      expect(files?.tools).toEqual(manifest)
    })

    it("removes the directory when the call ends", async () => {
      const created = clean()
      await run(created)
      expect(existsSync(created.files()[0]?.directory ?? "")).toBe(false)
    })

    it("removes the directory when the call fails", async () => {
      const created = harness({
        scenario: { script: [{ raw: "not json" }, { exit: 1 }] },
      })
      await failureOf(run(created))
      expect(existsSync(created.files()[0]?.directory ?? "")).toBe(false)
    })
  })

  describe("child environment", () => {
    async function turnEnv(options: HarnessOptions = {}): Promise<Record<string, string>> {
      const created = clean(options)
      await run(created)
      const env = created.invocations()[0]?.env
      if (env === undefined) throw new Error("the fake CLI did not start")
      return env
    }

    it("points the CLI at the relay", async () => {
      expect((await turnEnv()).ANTHROPIC_BASE_URL).toBe(FAKE_RELAY_URL)
    })

    it("sets the turn policy", async () => {
      expect(await turnEnv()).toMatchObject({
        ENABLE_TOOL_SEARCH: "false",
        CLAUDE_CODE_MAX_RETRIES: "0",
        DISABLE_AUTO_COMPACT: "1",
        DISABLE_COMPACT: "1",
        CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_FEEDBACK_COMMAND: "1",
        CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
      })
    })

    it("keeps auto memory off even when the harness turns it on", async () => {
      const env = await turnEnv({ env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" } })
      expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1")
    })

    it("keeps telemetry on by default", async () => {
      const env = await turnEnv()
      for (const name of QUIET) expect(env[name]).toBeUndefined()
    })

    it("sets the quiet flags when the setting is off", async () => {
      const env = await turnEnv({ settings: { claudeCodeTelemetry: false } })
      for (const name of QUIET) expect(env[name]).toBe("1")
    })

    it("never strips a user's own opt-out", async () => {
      const env = await turnEnv({ env: { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" } })
      expect(env.DISABLE_TELEMETRY).toBe("1")
      expect(env.DO_NOT_TRACK).toBe("1")
    })

    it("overwrites the inherited caller name", async () => {
      const env = await turnEnv({ env: { CLAUDE_CODE_ENTRYPOINT: "sdk-py" } })
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("deepseek-harness")
      expect(env.CLAUDE_CODE_DISABLE_ARTIFACT).toBe("1")
    })

    it("removes inherited request settings", async () => {
      const env = await turnEnv({
        env: { CLAUDE_CODE_EXTRA_BODY: "{}", CLAUDE_CODE_EFFORT_LEVEL: "max" },
      })
      expect(env.CLAUDE_CODE_EXTRA_BODY).toBeUndefined()
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined()
    })

    it("gives a child with no identity the running user", async () => {
      expect((await turnEnv()).USER).toBeTruthy()
    })

    it("does not forward a key-shaped name", async () => {
      const env = await turnEnv({ env: { ANTHROPIC_API_KEY: "fake-key" } })
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    })

    it("sets the output limit only when the request has one", async () => {
      const created = clean()
      await run(created, preparedRequest({ maxOutputTokens: 123 }))
      await run(created)
      const envs = created.invocations().map((invocation) => invocation.env)
      expect(envs[0]?.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("123")
      expect(envs[1]?.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined()
    })

    it("reads the settings on every spawn", async () => {
      const created = clean()
      created.settings = { ...created.settings, claudeConfigDir: "/first-login" }
      await run(created)
      created.settings = { ...created.settings, claudeConfigDir: "/second-login" }
      await run(created)
      expect(created.invocations().map((invocation) => invocation.env.CLAUDE_CONFIG_DIR)).toEqual([
        "/first-login",
        "/second-login",
      ])
    })

    it("runs every call in the one shared directory", async () => {
      const created = clean()
      await run(created)
      await run(created)
      expect(created.invocations().map((invocation) => invocation.cwd)).toEqual([
        sharedWorkdir(),
        sharedWorkdir(),
      ])
    })
  })

  describe("relay", () => {
    it("is opened with the queried frame and the request's facts", async () => {
      const created = clean({ settings: { readIdleTimeoutSeconds: 7 } })
      const frames = [userFrame("earlier"), userFrame("queried")]
      await run(created, preparedRequest({ frames, oneShot: true }))
      const options = created.relay.options[0]
      const queried: NativeBlock[] = [{ type: "text", text: "queried" }]
      expect(options).toMatchObject({
        upstream: "https://api.anthropic.com",
        timeoutMs: 7000,
        queried,
        oneShot: true,
      })
      expect(options?.env).toEqual(created.deps.processEnv())
    })
  })

  describe("frames", () => {
    it("marks replayed user turns and waits for their acknowledgment", async () => {
      const created = clean()
      await run(created, preparedRequest({ frames: REPLAYED_HISTORY }))
      expect(created.frames().map(({ type, shouldQuery }) => ({ type, shouldQuery }))).toEqual([
        { type: "user", shouldQuery: false },
        { type: "assistant" },
        { type: "user" },
      ])
    })

    it("carries a large history through stdin", async () => {
      const created = clean()
      const frames = [userFrame("x".repeat(2 * 1024 * 1024)), ...REPLAYED_HISTORY]
      await run(created, preparedRequest({ frames }))
      expect(created.frames()).toHaveLength(4)
      expect(created.frames()[0]?.bytes).toBeGreaterThan(2 * 1024 * 1024)
    })

    it("names the exit code and stderr when the CLI exits before the acknowledgment", async () => {
      const created = harness({
        scenario: { afterFirstFrame: [{ err: "replay frame rejected by native" }, { exit: 3 }] },
      })
      const failure = await failureOf(run(created, preparedRequest({ frames: REPLAYED_HISTORY })))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("Native exited before replay acknowledgment")
      expect(failure.message).toContain("exit=3")
      expect(failure.message).toContain("replay frame rejected by native")
    })

    it("refuses an acknowledgment that spent a turn", async () => {
      const created = harness({
        scenario: {
          afterFirstFrame: [
            { out: { type: "result", num_turns: 1, is_error: false } },
            { sleepMs: 30_000 },
          ],
        },
      })
      const failure = await failureOf(run(created, preparedRequest({ frames: REPLAYED_HISTORY })))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("zero-turn acknowledgment")
    })

    it("reports cancellation while it waits for the acknowledgment", async () => {
      const controller = new AbortController()
      const created = harness({
        scenario: { neverRead: true },
      })
      const pending = run(created, preparedRequest({ frames: REPLAYED_HISTORY }), controller.signal)
      await eventually(() => created.invocations().length === 1)
      controller.abort()
      const failure = await failureOf(pending)
      expect(failure.code).toBe(FailureCode.aborted)
    })
  })

  describe("completion", () => {
    it("yields stream events as they arrive and returns the capture", async () => {
      const created = clean({
        relay: {
          ...CLEAN_RELAY,
          requestId: "req_ok",
          unrestored: "fixture reason",
          denied: 0,
          message: capturedMessage({
            usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 7 },
          }),
        },
      })
      const { events, completion } = await run(created)
      expect(events).toEqual([
        { type: "content_block_delta", delta: { type: "text_delta", text: "FIRST" } },
        { type: "message_stop" },
      ])
      expect(completion.assistants.map((message) => message.id)).toEqual(["msg_captured"])
      expect(completion.usage).toEqual({
        input_tokens: 3,
        output_tokens: 2,
        cache_read_input_tokens: 7,
      })
      expect(completion.requestId).toBe("req_ok")
      expect(completion.blockedRequests).toBe(0)
      expect(completion.unrestored).toBe("fixture reason")
    })

    it("yields each event before the next one arrives", async () => {
      const created = harness({
        scenario: (root) => ({
          script: [
            { out: { type: "stream_event", event: { type: "ping" } } },
            { waitFor: join(root, "release") },
            ...cleanAnswer(),
            { exit: 0 },
          ],
        }),
      })
      const generator = runNative(preparedRequest(), undefined, created.deps)
      expect((await generator.next()).value).toEqual({ type: "ping" })
      writeFileSync(join(created.root, "release"), "")
      await drainRun(generator)
    })

    it("uses the CLI's own message and result usage when the relay was not used", async () => {
      const created = harness({
        relay: {},
        scenario: { script: [...cleanAnswer(), { exit: 0 }] },
      })
      const { completion } = await run(created)
      expect(completion.assistants.map((message) => message.content)).toEqual([
        [{ type: "text", text: "FIRST" }],
      ])
      expect(completion.usage).toEqual(USAGE)
      expect(completion.requestId).toBeNull()
    })

    it("keeps every assistant row of an unused relay", async () => {
      const rows: FakeClaudeStep[] = ["one", "two"].map((text) => ({
        out: {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text }] },
        },
      }))
      const created = harness({
        relay: {},
        scenario: {
          script: [
            ...rows,
            STOP,
            { out: { type: "result", subtype: "success", usage: USAGE } },
            { exit: 0 },
          ],
        },
      })
      const { completion } = await run(created)
      expect(completion.assistants).toHaveLength(2)
      expect(completion.assistants[1]?.usage).toEqual(USAGE)
    })

    it("accepts a final text that extends what was streamed", async () => {
      const created = clean({
        relay: {
          ...CLEAN_RELAY,
          message: capturedMessage({ content: [{ type: "text", text: "FIRST and more" }] }),
        },
      })
      const { completion } = await run(created)
      expect(completion.assistants[0]?.content).toEqual([{ type: "text", text: "FIRST and more" }])
    })

    it("refuses a final text that differs from what was streamed", async () => {
      const created = clean({
        relay: {
          ...CLEAN_RELAY,
          message: capturedMessage({ content: [{ type: "text", text: "OTHER" }] }),
        },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("differs from")
    })

    it("refuses an answer with incomplete usage", async () => {
      const created = harness({
        relay: {},
        scenario: {
          script: [...cleanAnswer({ usage: { input_tokens: 3 } }), { exit: 0 }],
        },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("token usage")
    })
  })

  describe("failure mapping", () => {
    it.each([
      ["rate_limit", "You've hit your session limit · resets 3:45pm", FailureCode.rateLimit, 429],
      ["billing_error", "Credit balance is too low", FailureCode.quota, 402],
      ["overloaded", "API Error: Overloaded", FailureCode.server, 529],
      ["server_error", "API Error: 500 Internal server error", FailureCode.server, 503],
      ["unknown", "API Error: something else", FailureCode.nativeProtocol, undefined],
    ])("maps the native error %s", async (code, text, expectedCode, status) => {
      const created = harness({
        relay: {},
        scenario: { script: nativeErrorAnswer(code, text) },
      })
      const failure = await failureOf(run(created))
      expect(failure.message).toBe(`Native API error: ${text}`)
      expect(failure.code).toBe(expectedCode)
      expect(failure.failure.status).toBe(status)
    })

    it("names a logged-out CLI with the login hint and its stderr", async () => {
      const created = harness({
        relay: {},
        scenario: {
          script: [
            { err: "diagnostic: keychain locked" },
            ...nativeErrorAnswer("authentication_failed", "Not logged in · Please run /login"),
          ],
        },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.invalidCredential)
      expect(failure.failure.status).toBe(401)
      expect(failure.message).toContain("claude auth login")
      expect(failure.message).toContain("Not logged in")
      expect(failure.message).toContain("keychain locked")
    })

    it("maps authentication_failed behind a used relay without the login hint", async () => {
      const created = harness({
        scenario: { script: nativeErrorAnswer("authentication_failed", "Token expired") },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.invalidCredential)
      expect(failure.failure.status).toBe(401)
      expect(failure.message).toBe("Native API error: Token expired")
    })

    it.each([
      [429, FailureCode.rateLimit],
      [401, FailureCode.invalidCredential],
      [403, FailureCode.invalidCredential],
      [402, FailureCode.quota],
      [400, FailureCode.upstreamError],
      [404, FailureCode.upstreamError],
      [500, FailureCode.server],
      [529, FailureCode.server],
    ])("maps upstream status %i", async (status, code) => {
      const created = harness({
        relay: {
          used: true,
          status,
          requestId: "req_fixture_01",
          errorText: "fixture said no",
          denied: 1,
        },
        scenario: {
          script: [...nativeErrorAnswer("server_error", "DSH_MODEL_ADMISSION_CONSUMED")],
        },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(code)
      expect(failure.failure.status).toBe(status)
      expect(failure.failure.requestId).toBe("req_fixture_01")
      expect(failure.message).toContain(
        `Incomplete upstream response (first upstream attempt: status ${status}, capture incomplete`,
      )
      expect(failure.message).toContain("upstream said: fixture said no")
      expect(failure.message).toContain("native retries denied: 1")
      expect(failure.message).toContain("request_id=req_fixture_01")
    })

    it.each([
      "prompt is too long: 213000 tokens > 200000 maximum",
      "input length and `max_tokens` exceed context limit: 190000 + 20000 > 200000",
      "the request exceeds the context window",
    ])("maps the upstream message %j to contextWindowExceeded", async (errorText) => {
      const created = harness({
        relay: { used: true, status: 400, errorText },
        scenario: { script: [{ exit: 1 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.contextWindowExceeded)
      expect(failure.failure.status).toBe(400)
    })

    it("keeps the real status of a context-window answer", async () => {
      const created = harness({
        relay: { used: true, status: 529, errorText: "prompt is too long: 213000 tokens" },
        scenario: { script: [{ exit: 1 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.contextWindowExceeded)
      expect(failure.failure.status).toBe(529)
    })

    it("maps a 200 cut short to transport, with no status", async () => {
      const created = harness({
        relay: { used: true, status: 200, complete: false, requestId: "req_cut" },
        scenario: { script: [{ exit: 1 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.transport)
      expect(failure.failure.status).toBeUndefined()
      expect(failure.failure.requestId).toBe("req_cut")
      expect(failure.message).toContain("status 200, capture incomplete")
    })

    describe("retry-after", () => {
      it.each([429, 500, 529])("passes the delay of a %i answer to DSH", async (status) => {
        const created = harness({
          relay: { used: true, status, retryAfterMs: 12_000, errorText: "slow down", denied: 1 },
          scenario: { script: [{ exit: 1 }] },
        })
        const failure = await failureOf(run(created))
        expect(failure.failure.providerRetryAfterMs).toBe(12_000)
      })

      it("sets no delay when the answer had none", async () => {
        const created = harness({
          relay: { used: true, status: 429, retryAfterMs: null, errorText: "slow down" },
          scenario: { script: [{ exit: 1 }] },
        })
        const failure = await failureOf(run(created))
        expect(failure.failure).not.toHaveProperty("providerRetryAfterMs")
      })
    })

    describe("an error event inside a 200 stream", () => {
      const streamEnded = (error: { type: string; message: string }, requestId: string | null) =>
        harness({
          relay: { used: true, status: 200, complete: false, error, requestId, denied: 1 },
          scenario: {
            script: [
              ...nativeErrorAnswer(
                "invalid_request",
                "API Error: 400 DSH_MODEL_ADMISSION_CONSUMED",
              ),
            ],
          },
        })

      it.each([
        ["overloaded_error", FailureCode.server, 529],
        ["rate_limit_error", FailureCode.rateLimit, 429],
        ["api_error", FailureCode.server, 500],
        ["authentication_error", FailureCode.invalidCredential, 401],
        ["invalid_request_error", FailureCode.upstreamError, 400],
      ])("maps %s", async (type, code, status) => {
        const created = streamEnded({ type, message: "Upstream said so" }, null)
        const failure = await failureOf(run(created))
        expect(failure.code).toBe(code)
        expect(failure.failure.status).toBe(status)
        expect(failure.message).toBe("Upstream said so")
      })

      it("maps an invalid request that names the context window", async () => {
        const created = streamEnded(
          { type: "invalid_request_error", message: "prompt is too long: 213000 tokens" },
          null,
        )
        const failure = await failureOf(run(created))
        expect(failure.code).toBe(FailureCode.contextWindowExceeded)
        expect(failure.failure.status).toBe(400)
      })

      it("maps another type to transport with no status", async () => {
        const created = streamEnded({ type: "future_error", message: "Something new" }, null)
        const failure = await failureOf(run(created))
        expect(failure.code).toBe(FailureCode.transport)
        expect(failure.failure.status).toBeUndefined()
        expect(failure.message).toBe("Something new")
      })

      it("keeps the request id and leaves out the CLI's own words", async () => {
        const created = streamEnded(
          { type: "overloaded_error", message: "Overloaded" },
          "req_cut_1",
        )
        const failure = await failureOf(run(created))
        expect(failure.failure.requestId).toBe("req_cut_1")
        expect(failure.message).toBe("Overloaded (request_id=req_cut_1)")
        expect(failure.message).not.toContain("DSH_MODEL_ADMISSION_CONSUMED")
      })
    })

    it("maps a relay failure to transport and names it", async () => {
      const created = harness({
        relay: { used: true, status: null, failure: "ConnectionResetError" },
        scenario: { script: [{ exit: 1 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.transport)
      expect(failure.failure.status).toBeUndefined()
      expect(failure.message).toContain("relay failure ConnectionResetError")
    })

    it("names the offending line of malformed stream-json, with stderr", async () => {
      const created = harness({
        relay: {},
        scenario: {
          script: [{ err: "shim noise" }, { raw: "mise WARN tool not activated" }, { exit: 0 }],
        },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("Invalid native stream-json output")
      expect(failure.message).toContain("mise WARN tool not activated")
    })

    it.each<[string, FakeClaudeStep]>([
      ["a number", { raw: "12" }],
      ["a list", { raw: "[1]" }],
      ["a stream event with no event", { out: { type: "stream_event" } }],
    ])("treats %s on stdout as malformed", async (_kind, step) => {
      const created = harness({
        relay: {},
        scenario: { script: [step, { exit: 0 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
    })

    it.each<[string, FakeClaudeStep[]]>([
      ["no assistant", [STOP, { out: { type: "result", subtype: "success", usage: USAGE } }]],
      [
        "no message_stop",
        [
          {
            out: {
              type: "assistant",
              message: { role: "assistant", content: [{ type: "text", text: "x" }] },
            },
          },
          { out: { type: "result", subtype: "success", usage: USAGE } },
        ],
      ],
      ["no result", cleanAnswer().slice(0, 3)],
      [
        "two results",
        [...cleanAnswer(), { out: { type: "result", subtype: "success", usage: USAGE } }],
      ],
    ])("refuses an incomplete native answer: %s", async (_case, script) => {
      const created = harness({
        relay: {},
        scenario: { script: [...script, { exit: 0 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("Incomplete native response")
    })

    it("raises nativeProtocol for a non-zero exit with stderr", async () => {
      const created = harness({
        relay: {},
        scenario: { script: [...cleanAnswer(), { err: "something broke" }, { exit: 7 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("Native request failed")
      expect(failure.message).toContain("something broke")
    })

    it("never prints the relay route from stderr or a native error", async () => {
      const created = harness({
        relay: {},
        scenario: {
          script: [
            { err: `could not reach ${FAKE_RELAY_URL}/v1/messages` },
            ...nativeErrorAnswer("unknown", `Connection error at ${FAKE_RELAY_URL}/v1/messages`),
          ],
        },
      })
      const failure = await failureOf(run(created))
      expect(failure.message).not.toContain("fake-private-route")
    })

    it("raises conflictingEnvironment before it starts anything", async () => {
      const created = clean({ env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" } })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.conflictingEnvironment)
      expect(failure.message).toContain("ANTHROPIC_BASE_URL")
      expect(failure.message).not.toContain("gateway.example.com")
      expect(created.subprocess.spawned).toHaveLength(0)
      expect(created.relay.created).toHaveLength(0)
    })

    it("raises claudeCodeMissing with status 503", async () => {
      const created = harness({ command: "/nonexistent/claude" })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.claudeCodeMissing)
      expect(failure.failure.status).toBe(503)
      expect(failure.message.toLowerCase()).toContain("not installed")
      expect(created.relay.created).toHaveLength(0)
    })

    it("closes the relay and raises when the process cannot start", async () => {
      const created = clean()
      const spawn = created.deps.subprocess.spawn
      created.deps.subprocess.spawn = () => {
        throw new Error("fixture spawn failure")
      }
      const failure = await failureOf(run(created))
      created.deps.subprocess.spawn = spawn
      expect(failure.code).toBe(FailureCode.nativeProtocol)
      expect(failure.message).toContain("fixture spawn failure")
      expect(created.relay.last().closed).toBe(true)
    })

    it("surfaces a relay that cannot open as a failure", async () => {
      const created = clean()
      created.deps.createRelay = async () => {
        throw new Error("fixture bind failure")
      }
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.relayError)
      expect(created.subprocess.spawned).toHaveLength(0)
    })

    it("passes a failure from the relay on as it stands", async () => {
      const created = clean()
      const refused = new NativeFailure("SOCKS proxy refused", FailureCode.transport)
      created.deps.createRelay = async () => {
        throw refused
      }
      expect(await failureOf(run(created))).toBe(refused)
    })
  })

  describe("idle timeout", () => {
    it("fails a silent CLI and cleans up", async () => {
      const created = harness({
        settings: { readIdleTimeoutSeconds: 0.2 },
        scenario: { script: [{ sleepMs: 30_000 }] },
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.timeout)
      expect(failure.failure.status).toBeUndefined()
      expect(created.relay.last().closed).toBe(true)
      expect(existsSync(created.files()[0]?.directory ?? "")).toBe(false)
    })

    it("restarts on every event", async () => {
      const tick: FakeClaudeStep[] = [
        { sleepMs: 100 },
        { out: { type: "stream_event", event: { type: "ping" } } },
      ]
      const created = harness({
        settings: { readIdleTimeoutSeconds: 0.5 },
        scenario: {
          script: [
            ...tick,
            ...tick,
            ...tick,
            ...tick,
            ...tick,
            ...tick,
            ...tick,
            ...tick,
            ...cleanAnswer(),
            { exit: 0 },
          ],
        },
      })
      await expect(run(created)).resolves.toBeDefined()
    })

    it("does not count time the consumer holds the generator", async () => {
      const created = clean({ settings: { readIdleTimeoutSeconds: 0.2 } })
      const generator = runNative(preparedRequest(), undefined, created.deps)
      await generator.next()
      await sleep(400)
      await expect(drainRun(generator)).resolves.toBeDefined()
    })

    it("covers a child that stops reading stdin", async () => {
      const created = harness({
        settings: { readIdleTimeoutSeconds: 0.3 },
        scenario: { neverRead: true },
      })
      const started = Date.now()
      const failure = await failureOf(
        run(created, preparedRequest({ frames: [userFrame("x".repeat(2 * 1024 * 1024))] })),
      )
      expect(failure.code).toBe(FailureCode.timeout)
      expect(Date.now() - started).toBeLessThan(5000)
    })

    it("ends a descendant that keeps stdout open after the launcher exits", async () => {
      const created = harness({
        settings: { readIdleTimeoutSeconds: 0.3 },
        scenario: (root) => ({
          script: [
            { descendant: { pidFile: join(root, "descendant.pid"), inheritStdout: true } },
            { exit: 0 },
          ],
        }),
      })
      const failure = await failureOf(run(created))
      expect(failure.code).toBe(FailureCode.timeout)
      const pid = Number(readFileSync(join(created.root, "descendant.pid"), "utf8"))
      await eventually(() => !processAlive(pid))
    })
  })

  describe("cancellation", () => {
    it("never spawns when the signal is already aborted", async () => {
      const controller = new AbortController()
      controller.abort()
      const created = clean()
      const failure = await failureOf(run(created, preparedRequest(), controller.signal))
      expect(failure.code).toBe(FailureCode.aborted)
      expect(failure.failure.status).toBeUndefined()
      expect(created.subprocess.spawned).toHaveLength(0)
      expect(created.relay.created).toHaveLength(0)
    })

    it("never spawns when the signal fires while the relay opens", async () => {
      const controller = new AbortController()
      const created = clean()
      const open = created.relay.create
      created.deps.createRelay = async (options) => {
        const relay = await open(options)
        controller.abort()
        return relay
      }
      const failure = await failureOf(run(created, preparedRequest(), controller.signal))
      expect(failure.code).toBe(FailureCode.aborted)
      expect(created.subprocess.spawned).toHaveLength(0)
      expect(created.relay.last().closed).toBe(true)
    })

    it("takes the whole tree down, with the relay, and reports the cancel", async () => {
      const controller = new AbortController()
      const created = harness({
        scenario: (root) => ({
          script: [
            { descendant: { pidFile: join(root, "descendant.pid") } },
            { out: { type: "stream_event", event: { type: "ping" } } },
            { sleepMs: 30_000 },
          ],
        }),
      })
      const generator = runNative(preparedRequest(), controller.signal, created.deps)
      expect((await generator.next()).value).toEqual({ type: "ping" })
      const pid = Number(readFileSync(join(created.root, "descendant.pid"), "utf8"))
      const nativePid = created.subprocess.spawned[0]?.pid ?? 0
      controller.abort()
      expect(created.relay.last().aborted).toBe(true)
      const failure = await failureOf(generator.next())
      expect(failure.code).toBe(FailureCode.aborted)
      await eventually(() => !processAlive(pid) && !processAlive(nativePid))
      expect(created.relay.last().closed).toBe(true)
    })

    it("cancels a child that stops reading stdin", async () => {
      const controller = new AbortController()
      const created = harness({ scenario: { neverRead: true } })
      const pending = run(
        created,
        preparedRequest({ frames: [userFrame("x".repeat(2 * 1024 * 1024))] }),
        controller.signal,
      )
      await eventually(() => created.invocations().length === 1)
      controller.abort()
      const failure = await failureOf(pending)
      expect(failure.code).toBe(FailureCode.aborted)
    })

    it("reaps the child when the consumer closes a paused generator", async () => {
      const created = harness({
        scenario: {
          script: [{ out: { type: "stream_event", event: { type: "ping" } } }, { sleepMs: 30_000 }],
        },
      })
      const generator = runNative(preparedRequest(), undefined, created.deps)
      await generator.next()
      const nativePid = created.subprocess.spawned[0]?.pid ?? 0
      await generator.return(undefined as never)
      await eventually(() => !processAlive(nativePid))
      expect(created.relay.last().closed).toBe(true)
      expect(existsSync(created.files()[0]?.directory ?? "")).toBe(false)
    })
  })

  describe("frame guard", () => {
    it("raises invalidRequest with no frame to query", async () => {
      const created = clean()
      const failure = await failureOf(run(created, preparedRequest({ frames: [] })))
      expect(failure.code).toBe(FailureCode.invalidRequest)
      expect(created.subprocess.spawned).toHaveLength(0)
    })
  })
})
