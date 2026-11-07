import { describe, expect, it } from "vitest"
import { shellQuote } from "../src/shared/shell"
import { SshOptionError, splitSshOption, validateSshOptions } from "../src/shared/ssh-options"
import {
  assertTargetFields,
  isValidSecretField,
  isValidTargetName,
  normalizeTarget,
} from "../src/shared/target"
import type { RemoteTarget } from "../src/shared/types"

describe("target names", () => {
  it("accepts short lowercase names", () => {
    expect(isValidTargetName("web1")).toBe(true)
    expect(isValidTargetName("core-sw")).toBe(true)
    expect(isValidTargetName("0")).toBe(true)
  })

  it("rejects names the tool contract cannot carry", () => {
    expect(isValidTargetName("Web1")).toBe(false)
    expect(isValidTargetName("-web")).toBe(false)
    expect(isValidTargetName("web_1")).toBe(false)
    expect(isValidTargetName("")).toBe(false)
    expect(isValidTargetName("a".repeat(33))).toBe(false)
  })
})

describe("target fields", () => {
  it("rejects a host with whitespace or a leading hyphen", () => {
    expect(() => assertTargetFields({ name: "web", host: "bad host" })).toThrow(/host/)
    expect(() => assertTargetFields({ name: "web", host: "-oProxyCommand=sh" })).toThrow(/host/)
    expect(() => assertTargetFields({ name: "web", host: "example.com" })).not.toThrow()
  })

  it("rejects an invalid port and a self jump", () => {
    expect(() => assertTargetFields({ name: "web", host: "example.com", port: 0 })).toThrow(/port/)
    expect(() => assertTargetFields({ name: "web", host: "example.com", jump: "web" })).toThrow(
      /jump/,
    )
  })
})

describe("normalizeTarget", () => {
  it("drops absent optional fields", () => {
    const target: RemoteTarget = {
      name: "web1",
      transport: "ssh",
      kind: "linux",
      host: "example.com",
      sshOptions: [],
      secrets: [],
      initCommands: [],
    }
    const normalized = normalizeTarget(target)
    expect(normalized).toEqual(target)
    expect(Object.hasOwn(normalized, "user")).toBe(false)
  })
})

describe("ssh options", () => {
  it("splits Key=Value once", () => {
    expect(splitSshOption("StrictHostKeyChecking=no")).toEqual({
      key: "StrictHostKeyChecking",
      value: "no",
    })
    expect(splitSshOption("ProxyCommand=ssh a=b")).toEqual({
      key: "ProxyCommand",
      value: "ssh a=b",
    })
  })

  it("rejects malformed options", () => {
    expect(() => splitSshOption("StrictHostKeyChecking")).toThrow(SshOptionError)
    expect(() => splitSshOption("=no")).toThrow(SshOptionError)
  })

  it("rejects local-execution options regardless of case", () => {
    expect(() => validateSshOptions(["ProxyCommand=sh -c id"], ["ProxyCommand"])).toThrow(
      /not allowed/,
    )
    expect(() => validateSshOptions(["proxycommand=sh -c id"], ["ProxyCommand"])).toThrow(
      /not allowed/,
    )
  })

  it("rejects duplicate options", () => {
    expect(() => validateSshOptions(["Port=22", "port=2222"], [])).toThrow(/more than once/)
  })

  it("returns the options unchanged when they pass", () => {
    expect(validateSshOptions(["StrictHostKeyChecking=accept-new"], ["ProxyCommand"])).toEqual([
      "StrictHostKeyChecking=accept-new",
    ])
  })
})

describe("shellQuote", () => {
  it("quotes spaces, quotes, and empty strings", () => {
    expect(shellQuote("plain")).toBe("'plain'")
    expect(shellQuote("a b")).toBe("'a b'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote("")).toBe("''")
  })
})

describe("secret field names", () => {
  it("accepts short field names", () => {
    expect(isValidSecretField("login")).toBe(true)
    expect(isValidSecretField("sudo")).toBe(true)
    expect(isValidSecretField("enable")).toBe(true)
  })

  it("rejects other names", () => {
    expect(isValidSecretField("Login")).toBe(false)
    expect(isValidSecretField("")).toBe(false)
    expect(isValidSecretField("a b")).toBe(false)
  })
})
