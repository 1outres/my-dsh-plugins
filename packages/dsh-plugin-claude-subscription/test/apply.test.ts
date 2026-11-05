import { basename } from "node:path"
import type { Context } from "@deepseek-ai/cordis"
import type { LlmAdapter, LlmConfigurableProvider } from "@deepseek-ai/dsh-llm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NativeDeps } from "../src/contract"
import { FailureCode, NativeFailure } from "../src/errors"
import { apply, Config, inject, name } from "../src/index"
import { discoverModels } from "../src/native/setup"
import { prepareRequest } from "../src/request/prepare"
import { imageRef } from "./support/attachments"

vi.mock("../src/native/setup", () => ({ discoverModels: vi.fn() }))
vi.mock("../src/native/run", () => ({ runNative: vi.fn() }))
vi.mock("../src/relay/relay", () => ({ createRelay: vi.fn() }))
vi.mock("../src/request/prepare", () => ({ prepareRequest: vi.fn() }))

const NAMESPACE = "claude-subscription-row"

describe("plugin entry", () => {
  let adapter: LlmAdapter
  let routes: string[]
  let directory: { entries: readonly LlmConfigurableProvider[]; history: string[] }
  let warn: ReturnType<typeof vi.fn>
  let getService: ReturnType<typeof vi.fn>
  const subprocess = { spawn: vi.fn(), resolveExecutable: vi.fn() }

  function start(
    raw: Record<string, unknown> = {},
    fiber: unknown = { entry: { options: { id: NAMESPACE } } },
  ) {
    const ctx = {
      llm: {
        registerAdapter: (providers: string[], registered: LlmAdapter) => {
          routes = providers
          adapter = registered
        },
        registerConfigurableProviders: (entries: readonly LlmConfigurableProvider[]) => {
          directory.entries = entries
          return {
            replace: (next: readonly LlmConfigurableProvider[]) => {
              directory.entries = next
              directory.history.push(next[0]?.error ?? "clear")
            },
          }
        },
      },
      subprocess,
      logger: { warn },
      get: getService,
      fiber,
    }
    apply(ctx as unknown as Context, Config(raw))
  }

  function nativeDeps(): NativeDeps {
    return vi.mocked(discoverModels).mock.calls[0]?.[0] as NativeDeps
  }

  beforeEach(() => {
    vi.clearAllMocks()
    directory = { entries: [], history: [] }
    warn = vi.fn()
    getService = vi.fn()
    vi.mocked(discoverModels).mockResolvedValue([{ id: "opus", name: "Opus 5.5" }])
  })

  it("exports the plugin identity and needs the llm and subprocess services", () => {
    expect(name).toBe("claude-subscription")
    expect(inject).toEqual(["llm", "subprocess"])
  })

  it.each([
    ["a fiber with no entry", {}],
    ["an entry with no options", { entry: {} }],
    ["an entry with an empty id", { entry: { options: { id: "" } } }],
    ["an entry whose id is not text", { entry: { options: { id: 7 } } }],
  ])("fails activation for %s, because the settings row cannot be found", (_name, fiber) => {
    expect(() => start({}, fiber)).toThrow(/entry id/)
    expect(directory.entries).toEqual([])
  })

  it("registers the claude-subscription route", () => {
    start()
    expect(routes).toEqual(["claude-subscription"])
  })

  it("lists the route in the provider directory, under its settings row", () => {
    start()
    expect(directory.entries).toEqual([
      {
        provider: "claude-subscription",
        displayName: "Claude Subscription",
        settingsNs: NAMESPACE,
        settingsPath: [],
      },
    ])
  })

  it("wires the subprocess service and the built script next to the entry", async () => {
    start()
    await adapter.listModels("claude-subscription")
    const native = nativeDeps()
    expect(native.subprocess).toBe(subprocess)
    expect(native.nodePath).toBe(process.execPath)
    expect(basename(native.inertMcpPath)).toBe("inert-mcp.js")
    expect(native.processEnv()).toBe(process.env)
  })

  it("reads settings on every call, so a change applies to the next one", async () => {
    start({ command: "/opt/claude", readIdleTimeoutSeconds: 5 })
    await adapter.listModels("claude-subscription")
    expect(nativeDeps().settings()).toEqual({
      command: "/opt/claude",
      claudeConfigDir: "",
      claudeCodeTelemetry: true,
      readIdleTimeoutSeconds: 5,
    })
  })

  it("shows a discovery failure on the directory row and clears it afterwards", async () => {
    start()
    const failure = new NativeFailure("Not logged in", FailureCode.invalidCredential)
    vi.mocked(discoverModels).mockRejectedValueOnce(failure)
    await expect(adapter.listModels("claude-subscription")).rejects.toBe(failure)
    expect(directory.entries[0]?.error).toBe("Not logged in")
    await adapter.listModels("claude-subscription")
    expect(directory.entries[0]).not.toHaveProperty("error")
  })

  it("does not touch the directory while nothing changes", async () => {
    start()
    await adapter.listModels("claude-subscription")
    expect(directory.history).toEqual([])
  })

  describe("the read-only path of an image", () => {
    const ref = imageRef()

    async function imageAccess() {
      start()
      vi.mocked(prepareRequest).mockRejectedValue(
        new NativeFailure("x", FailureCode.invalidRequest),
      )
      const options = { provider: "claude-subscription", model: "opus", messages: [] }
      for await (const _chunk of adapter.stream(options)) {
        // The failure ends the stream. Only the call to prepareRequest matters here.
      }
      const deps = vi.mocked(prepareRequest).mock.calls[0]?.[1]
      return deps?.imageAccess(ref)
    }

    function services(attachments: unknown, fs: unknown) {
      getService.mockImplementation((name: string) =>
        name === "attachments" ? attachments : name === "fs" ? fs : undefined,
      )
    }

    it("maps the host path of the normalized copy into the world tools run in", async () => {
      const imageHostPath = vi.fn(() => "/host/store/abab.png")
      const processPathFromHostPath = vi.fn(() => "/mnt/store/abab.png")
      services({ imageHostPath }, { processPathFromHostPath })
      expect(await imageAccess()).toEqual({ readonlyPath: "/mnt/store/abab.png" })
      expect(imageHostPath).toHaveBeenCalledWith(ref)
      expect(processPathFromHostPath).toHaveBeenCalledWith("/host/store/abab.png")
    })

    it.each<[string, unknown, unknown]>([
      ["no attachments service", undefined, { processPathFromHostPath: () => "/x" }],
      ["no host path", { imageHostPath: () => undefined }, { processPathFromHostPath: () => "/x" }],
      ["no fs service", { imageHostPath: () => "/host/x.png" }, undefined],
      [
        "a host path the fs cannot map",
        { imageHostPath: () => "/host/x.png" },
        { processPathFromHostPath: () => undefined },
      ],
    ])("gives no path for %s", async (_name, attachments, fs) => {
      services(attachments, fs)
      expect(await imageAccess()).toBeUndefined()
    })
  })

  it("resolves the optional attachments service for each request", async () => {
    start()
    const attachments = { readImageRequest: vi.fn() }
    getService.mockReturnValue(attachments)
    vi.mocked(prepareRequest).mockRejectedValue(new NativeFailure("x", FailureCode.invalidRequest))
    const options = { provider: "claude-subscription", model: "opus", messages: [] }
    for await (const _chunk of adapter.stream(options)) {
      // The failure ends the stream. Only the call to prepareRequest matters here.
    }
    const deps = vi.mocked(prepareRequest).mock.calls[0]?.[1]
    expect(deps?.attachments()).toBe(attachments)
    expect(getService).toHaveBeenCalledWith("attachments")
  })
})
