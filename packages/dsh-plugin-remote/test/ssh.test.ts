import { describe, expect, it } from "vitest"
import { classifyAskpassPrompt, promptLabel } from "../src/host/transport/ssh/askpass-prompt"
import {
  buildExecArgv,
  buildMasterArgv,
  buildProxyCommand,
  buildReadScript,
  buildShellArgv,
  buildSudoCommand,
  buildWriteScript,
} from "../src/host/transport/ssh/command"

describe("askpass prompt classification", () => {
  it("recognizes the login password", () => {
    expect(classifyAskpassPrompt("user@example.com's password: ")).toEqual({
      kind: "secret",
      field: "login",
      prompt: "user@example.com's password: ",
    })
  })

  it("recognizes a key passphrase", () => {
    expect(
      classifyAskpassPrompt("Enter passphrase for key '/home/u/.ssh/id_ed25519':"),
    ).toMatchObject({
      kind: "secret",
      field: "passphrase",
    })
  })

  it("parses an unknown host key fingerprint", () => {
    const prompt =
      "The authenticity of host 'example.com (192.0.2.1)' can't be established.\nED25519 key fingerprint is SHA256:abcdefABCDEF0123456789.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? "
    expect(classifyAskpassPrompt(prompt)).toEqual({
      kind: "hostkey",
      changed: false,
      hostKey: {
        host: "example.com",
        algorithm: "ED25519",
        fingerprint: "SHA256:abcdefABCDEF0123456789",
      },
    })
  })

  it("marks a changed host key", () => {
    const prompt =
      "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nThe fingerprint for the ED25519 key sent by the remote host is\nSHA256:xyz.\nPlease contact your system administrator.\nAre you sure you want to continue connecting (yes/no)? "
    expect(classifyAskpassPrompt(prompt)).toMatchObject({ kind: "hostkey", changed: true })
  })

  it("keeps an unknown keyboard-interactive prompt as generic text", () => {
    expect(classifyAskpassPrompt("Verification code:")).toEqual({
      kind: "generic",
      prompt: "Verification code:",
      label: "Verification code",
    })
  })

  it("uses the first line as a generic label", () => {
    expect(promptLabel("  First line  \nSecond line")).toBe("First line")
  })
})

describe("ssh command building", () => {
  const target = {
    host: "example.com",
    user: "ops",
    port: 2222,
    sshOptions: ["StrictHostKeyChecking=accept-new"],
  }

  it("builds a master command with the control path and persistence", () => {
    expect(buildMasterArgv("ssh", target, "/tmp/a.sock", 600)).toEqual([
      "ssh",
      "-M",
      "-N",
      "-S",
      "/tmp/a.sock",
      "-o",
      "ControlPersist=600",
      "-l",
      "ops",
      "-p",
      "2222",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "example.com",
    ])
  })

  it("adds an internally built ProxyCommand to the master", () => {
    const argv = buildMasterArgv("ssh", target, "/tmp/a.sock", 600, "ssh -W %h:%p jump")
    expect(argv).toContain("ProxyCommand=ssh -W %h:%p jump")
  })

  it("builds a mux exec command", () => {
    expect(buildExecArgv("ssh", target, "/tmp/a.sock", "uname -a")).toEqual([
      "ssh",
      "-T",
      "-S",
      "/tmp/a.sock",
      "-o",
      "ControlMaster=no",
      "-o",
      "BatchMode=yes",
      "-l",
      "ops",
      "-p",
      "2222",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "example.com",
      "uname -a",
    ])
  })

  it("builds an interactive shell command with a forced PTY", () => {
    expect(buildShellArgv("ssh", target, "/tmp/a.sock")).toContain("-tt")
  })

  it("quotes every word of the jump ProxyCommand", () => {
    const proxy = buildProxyCommand("ssh", { host: "jump", sshOptions: [] }, "/tmp/j.sock")
    expect(proxy).toBe(
      "'ssh' '-S' '/tmp/j.sock' '-o' 'ControlMaster=no' '-o' 'BatchMode=yes' '-W' '%h:%p' 'jump'",
    )
  })

  it("builds the sudo commands", () => {
    expect(buildSudoCommand("id", true)).toBe("LC_ALL=C sudo -n -- sh -c 'id'")
    expect(buildSudoCommand("id", false)).toBe("LC_ALL=C sudo -k -S -p '' -- sh -c 'id'")
    expect(buildSudoCommand("echo 'x'", false)).toBe(
      "LC_ALL=C sudo -k -S -p '' -- sh -c 'echo '\\''x'\\'''",
    )
  })

  it("writes the read and write scripts around the path", () => {
    expect(buildReadScript("/etc/a b")).toContain("'/etc/a b'")
    const write = buildWriteScript("/etc/a", "abc123")
    expect(write).toContain("sha256sum -- '/etc/a'")
    expect(write).toContain("\"$current\" = 'abc123'")
    expect(write).toContain("mv -f")
  })
})
