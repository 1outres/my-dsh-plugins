import { userInfo } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PluginSettings } from "../../src/contract"
import { FailureCode, NativeFailure } from "../../src/errors"
import { assertNoBackendOverride, nativeEnv, probeEnv } from "../../src/native/env"

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, userInfo: vi.fn(actual.userInfo) }
})

const SETTINGS: PluginSettings = {
  command: "claude",
  claudeConfigDir: "",
  claudeCodeTelemetry: true,
  readIdleTimeoutSeconds: 1800,
}

const QUIET = [
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
]

function conflictOf(env: Record<string, string>): NativeFailure {
  try {
    assertNoBackendOverride(env)
  } catch (error) {
    if (error instanceof NativeFailure) return error
    throw error
  }
  throw new Error("expected a conflict")
}

describe("assertNoBackendOverride", () => {
  it.each([
    ["ANTHROPIC_BASE_URL", "https://gateway.example.com"],
    ["CLAUDE_CODE_USE_BEDROCK", "fixture-on-a"],
    ["CLAUDE_CODE_USE_VERTEX", "fixture-on-b"],
    ["CLAUDE_CODE_USE_FOUNDRY", "fixture-on-c"],
  ])("refuses %s and names only the variable", (name, value) => {
    const failure = conflictOf({ [name]: value })
    expect(failure.code).toBe(FailureCode.conflictingEnvironment)
    expect(failure.message).toContain(name)
    expect(failure.message).not.toContain(value)
  })

  it("names every conflicting variable", () => {
    const failure = conflictOf({ ANTHROPIC_BASE_URL: "x", CLAUDE_CODE_USE_VERTEX: "1" })
    expect(failure.message).toContain("ANTHROPIC_BASE_URL, CLAUDE_CODE_USE_VERTEX")
  })

  it.each(["", "0", "false", "no", "off", " OFF "])("accepts the switch value %j", (value) => {
    expect(() => assertNoBackendOverride({ CLAUDE_CODE_USE_BEDROCK: value })).not.toThrow()
  })

  it("treats key-shaped names as no conflict, since DSH scrubs them", () => {
    expect(() =>
      assertNoBackendOverride({
        ANTHROPIC_API_KEY: "fake",
        ANTHROPIC_AUTH_TOKEN: "fake",
        ANTHROPIC_FOUNDRY_API_KEY: "fake",
      }),
    ).not.toThrow()
  })

  it("accepts an empty base URL", () => {
    expect(() => assertNoBackendOverride({ ANTHROPIC_BASE_URL: "" })).not.toThrow()
  })
})

describe("nativeEnv", () => {
  it("sets the turn policy", () => {
    expect(nativeEnv(SETTINGS, {})).toMatchObject({
      ENABLE_TOOL_SEARCH: "false",
      CLAUDE_CODE_MAX_RETRIES: "0",
      DISABLE_AUTO_COMPACT: "1",
      DISABLE_COMPACT: "1",
      CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
      CLAUDE_CODE_SILENT_TURN_REMINDER: "0",
    })
  })

  it("tells the CLI not to load its memory or CLAUDE.md, even when told otherwise", () => {
    const env = nativeEnv(SETTINGS, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" })
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1")
    expect(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1")
  })

  it("removes key-shaped names and inherited request settings by explicit undefined", () => {
    const env = nativeEnv(SETTINGS, {})
    for (const name of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_FOUNDRY_API_KEY",
      "CLAUDE_CODE_EXTRA_BODY",
      "CLAUDE_CODE_EFFORT_LEVEL",
    ]) {
      expect(Object.hasOwn(env, name)).toBe(true)
      expect(env[name]).toBeUndefined()
    }
  })

  it("never returns the base URL of the harness", () => {
    const env = nativeEnv(SETTINGS, { ANTHROPIC_BASE_URL: "http://127.0.0.1:9" })
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})

describe.each([
  ["nativeEnv", nativeEnv],
  ["probeEnv", probeEnv],
])("%s shared policy", (_name, build) => {
  it("keeps telemetry and feature flags on by default", () => {
    const env = build(SETTINGS, {})
    for (const name of QUIET) expect(Object.hasOwn(env, name)).toBe(false)
  })

  it("restores the quiet flags when the setting is off", () => {
    const env = build({ ...SETTINGS, claudeCodeTelemetry: false }, {})
    for (const name of QUIET) expect(env[name]).toBe("1")
  })

  it("never removes a user's own opt-out", () => {
    const env = build(SETTINGS, { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" })
    expect(Object.hasOwn(env, "DISABLE_TELEMETRY")).toBe(false)
    expect(Object.hasOwn(env, "DO_NOT_TRACK")).toBe(false)
  })

  it.each([true, false])("always sets the quiet flags that gate no model (telemetry %s)", (on) => {
    expect(build({ ...SETTINGS, claudeCodeTelemetry: on }, {})).toMatchObject({
      DISABLE_AUTOUPDATER: "1",
      DISABLE_FEEDBACK_COMMAND: "1",
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
    })
  })

  it("overwrites an inherited caller name", () => {
    const env = build(SETTINGS, { CLAUDE_CODE_ENTRYPOINT: "sdk-py" })
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("deepseek-harness")
    expect(env.CLAUDE_CODE_DISABLE_ARTIFACT).toBe("1")
  })

  it("prefers the setting over the inherited config directory", () => {
    const env = build(
      { ...SETTINGS, claudeConfigDir: "/profile-login" },
      { CLAUDE_CONFIG_DIR: "/inherited-login" },
    )
    expect(env.CLAUDE_CONFIG_DIR).toBe("/profile-login")
  })

  it.each(["", " \t "])("falls through a blank setting %j to the inherited directory", (value) => {
    const env = build({ ...SETTINGS, claudeConfigDir: value }, { CLAUDE_CONFIG_DIR: "/inherited" })
    expect(env.CLAUDE_CONFIG_DIR).toBe("/inherited")
  })

  it("leaves the config directory alone when none is chosen", () => {
    expect(Object.hasOwn(build(SETTINGS, {}), "CLAUDE_CONFIG_DIR")).toBe(false)
  })

  it.each([
    ["setting", "  ~/login  ", {}],
    ["inherited", "", { CLAUDE_CONFIG_DIR: "~/login" }],
  ])("expands the home of the %s directory", (_source, setting, inherited) => {
    const env = build(
      { ...SETTINGS, claudeConfigDir: setting },
      { HOME: "/home/fixture", ...inherited },
    )
    expect(env.CLAUDE_CONFIG_DIR).toBe(join("/home/fixture", "login"))
  })

  it("keeps the inherited login identity", () => {
    const env = build(SETTINGS, { USER: "alice", LOGNAME: "alice-login" })
    expect(env.USER).toBe("alice")
    expect(env.LOGNAME).toBe("alice-login")
  })

  it("derives a missing login identity from the running user", () => {
    const { username } = userInfo()
    const env = build(SETTINGS, {})
    expect(env.USER).toBe(username)
    expect(env.LOGNAME).toBe(username)
  })

  describe("when no user resolves", () => {
    afterEach(() => {
      vi.mocked(userInfo).mockRestore()
    })

    function noSuchUser() {
      vi.mocked(userInfo).mockImplementation(() => {
        throw new Error("A system error occurred: uv_os_get_passwd returned ENOENT")
      })
    }

    it("sets no identity and does not throw", () => {
      noSuchUser()
      const env = build(SETTINGS, {})
      expect(Object.hasOwn(env, "USER")).toBe(false)
      expect(Object.hasOwn(env, "LOGNAME")).toBe(false)
    })

    it("still fills a missing name from the one that is set", () => {
      noSuchUser()
      expect(build(SETTINGS, { USER: "alice" }).LOGNAME).toBe("alice")
      expect(build(SETTINGS, { LOGNAME: "bob" }).USER).toBe("bob")
    })
  })

  it("keeps loopback traffic away from any proxy", () => {
    const env = build(SETTINGS, {})
    expect(env.NO_PROXY).toBe("127.0.0.1")
    expect(env.no_proxy).toBe("127.0.0.1")
  })

  it.each([
    [{ NO_PROXY: "corp.example" }, "corp.example,127.0.0.1"],
    [{ no_proxy: "lower.example" }, "lower.example,127.0.0.1"],
    [{ NO_PROXY: "upper.example", no_proxy: "lower.example" }, "lower.example,127.0.0.1"],
  ])("keeps the inherited proxy exceptions of %j", (inherited, expected) => {
    const env = build(SETTINGS, inherited)
    expect(env.NO_PROXY).toBe(expected)
    expect(env.no_proxy).toBe(expected)
  })

  it("uses USER for a missing LOGNAME", () => {
    expect(build(SETTINGS, { USER: "alice" }).LOGNAME).toBe("alice")
  })
})

describe("probeEnv", () => {
  it("does not set the turn policy", () => {
    const env = probeEnv(SETTINGS, {})
    expect(Object.hasOwn(env, "CLAUDE_CODE_MAX_RETRIES")).toBe(false)
    expect(Object.hasOwn(env, "CLAUDE_CODE_DISABLE_AUTO_MEMORY")).toBe(false)
  })

  it("removes key-shaped names and the base URL", () => {
    const env = probeEnv(SETTINGS, { ANTHROPIC_BASE_URL: "" })
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
      expect(Object.hasOwn(env, name)).toBe(true)
      expect(env[name]).toBeUndefined()
    }
  })
})
