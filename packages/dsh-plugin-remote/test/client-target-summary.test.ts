import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { en } from "../src/client/i18n"
import { TargetSummary } from "../src/client/TargetSummary"
import type { SerialTarget, SshTarget } from "../src/shared/types"

const t = (key: string): string => en[key] ?? key

function render(target: SshTarget | SerialTarget): string {
  return renderToStaticMarkup(createElement(TargetSummary, { target, t }))
}

const ssh: SshTarget = {
  name: "web1",
  transport: "ssh",
  kind: "network",
  secrets: ["login"],
  initCommands: ["terminal length 0"],
  host: "198.51.100.10",
  user: "admin",
  port: 2222,
  jump: "bastion",
  sshOptions: ["StrictHostKeyChecking=accept-new"],
}

const serial: SerialTarget = {
  name: "core-sw",
  transport: "serial",
  kind: "network",
  secrets: [],
  initCommands: ["terminal length 0"],
  agent: "pi",
  agentFingerprint: "SHA256:2f6Lc1Vb0vT9V0g7wJf3Wl6xqk0=",
  device: "/dev/ttyUSB0",
  serial: { baudRate: 115200, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none" },
  lineEnding: "cr",
}

describe("target summary", () => {
  it("shows the ssh destination, jump host and options", () => {
    const html = render(ssh)
    expect(html).toContain(en["label.host"] as string)
    expect(html).toContain("<dd>198.51.100.10</dd>")
    expect(html).toContain("<dd>admin</dd>")
    expect(html).toContain("<dd>2222</dd>")
    expect(html).toContain("<dd>bastion</dd>")
    expect(html).toContain("StrictHostKeyChecking=accept-new")
    expect(html).toContain(en["kind.network"] as string)
    expect(html).toContain("terminal length 0")
    expect(html).not.toContain(en["label.agent"] as string)
    expect(html).not.toContain(en["label.device"] as string)
    expect(html).not.toContain(en["card.register.serialDetail"] as string)
  })

  it("shows the agent, fingerprint, device and line settings of a serial target", () => {
    const html = render(serial)
    expect(html).toContain(en["label.agent"] as string)
    expect(html).toContain("<dd>pi</dd>")
    expect(html).toContain(en["label.agentFingerprint"] as string)
    expect(html).toContain("SHA256:2f6Lc1Vb0vT9V0g7wJf3Wl6xqk0=")
    expect(html).toContain(en["label.device"] as string)
    expect(html).toContain("<dd>/dev/ttyUSB0</dd>")
    expect(html).toContain(en["label.lineSettings"] as string)
    expect(html).toContain("<dd>115200 8N1</dd>")
    expect(html).toContain(en["label.enterKey"] as string)
    expect(html).toContain(en["lineEnding.cr"] as string)
    expect(html).toContain(en["label.transport"] as string)
    expect(html).toContain(en["label.kind"] as string)
    expect(html).toContain("terminal length 0")
  })

  it("asks the user to compare the agent key fingerprint before approving", () => {
    expect(render(serial)).toContain(en["card.register.serialDetail"] as string)
  })

  it("keeps the ssh fields off the serial card", () => {
    const html = render(serial)
    expect(html).not.toContain(en["label.host"] as string)
    expect(html).not.toContain(en["label.jump"] as string)
    expect(html).not.toContain(en["label.options"] as string)
  })
})
