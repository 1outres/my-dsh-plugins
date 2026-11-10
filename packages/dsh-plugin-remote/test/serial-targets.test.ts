import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { SessionEvent } from "@deepseek-ai/dsh-session"
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools"
import { describe, expect, it } from "vitest"
import type { HostRuntime, RootRuntime } from "../src/host/runtime"
import { SecretStore } from "../src/host/secrets/store"
import { SerialAgents } from "../src/host/serial/agents"
import { remoteTargetsProjection } from "../src/host/targets/projection"
import { parseTargetMeta, targetsViewSchema } from "../src/host/targets/schema"
import { registerTargetTools } from "../src/host/tools/targets"
import { assertSerialTargetFields, normalizeTarget } from "../src/shared/target"
import type { RemoteTarget, SerialTarget, SshTarget } from "../src/shared/types"
import { makeAgent } from "./serial/helpers"

const sshTarget: SshTarget = {
  name: "web1",
  transport: "ssh",
  kind: "linux",
  host: "example.com",
  sshOptions: [],
  secrets: ["login"],
  initCommands: [],
}

const serialTarget: SerialTarget = {
  name: "core-sw",
  transport: "serial",
  kind: "network",
  agent: "lab-mac",
  agentFingerprint: "SHA256:abc",
  device: "/dev/ttyUSB0",
  serial: { baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none" },
  lineEnding: "cr",
  secrets: ["enable"],
  initCommands: [],
}

describe("serial target fields", () => {
  it("accepts an ordinary console target", () => {
    expect(() => assertSerialTargetFields(serialTarget)).not.toThrow()
  })

  it("rejects a device path that is not absolute", () => {
    expect(() => assertSerialTargetFields({ ...serialTarget, device: "ttyUSB0" })).toThrow(
      /absolute path/,
    )
  })

  it("rejects whitespace and control characters in the device", () => {
    expect(() => assertSerialTargetFields({ ...serialTarget, device: "/dev/tty USB0" })).toThrow(
      /device/,
    )
    expect(() => assertSerialTargetFields({ ...serialTarget, device: "/dev/tty\u0000" })).toThrow(
      /device/,
    )
  })

  it("rejects a bad agent name and bad line settings", () => {
    expect(() => assertSerialTargetFields({ ...serialTarget, agent: "Lab Mac" })).toThrow(/agent/)
    expect(() =>
      assertSerialTargetFields({
        ...serialTarget,
        serial: { ...serialTarget.serial, baudRate: 10 },
      }),
    ).toThrow(/baudRate/)
    expect(() =>
      assertSerialTargetFields({
        ...serialTarget,
        serial: { ...serialTarget.serial, dataBits: 9 as 8 },
      }),
    ).toThrow(/dataBits/)
    expect(() =>
      assertSerialTargetFields({
        ...serialTarget,
        serial: { ...serialTarget.serial, stopBits: 3 as 1 },
      }),
    ).toThrow(/stopBits/)
    expect(() => assertSerialTargetFields({ ...serialTarget, lineEnding: "none" as "cr" })).toThrow(
      /lineEnding/,
    )
  })

  it("normalizes a serial target into plain JSON", () => {
    const normalized = normalizeTarget(serialTarget)
    expect(normalized).toEqual(serialTarget)
    expect(Object.hasOwn(normalized, "promptPattern")).toBe(false)
  })
})

describe("serial target projection", () => {
  it("uses state version 3 for the new serial fields", () => {
    expect(remoteTargetsProjection.stateVersion).toBe(3)
  })

  it("parses an old SSH-only meta value", () => {
    expect(parseTargetMeta({ kind: "remote/target-added", target: sshTarget })).toEqual({
      kind: "remote/target-added",
      target: sshTarget,
    })
  })

  it("parses a view with both kinds of target", () => {
    expect(targetsViewSchema.parse({ targets: [sshTarget, serialTarget] })).toEqual({
      targets: [sshTarget, serialTarget],
    })
  })

  it("folds a serial target from a successful result", () => {
    const state = remoteTargetsProjection.apply(
      { targets: [] },
      resultEvent({ kind: "remote/target-added", target: serialTarget }),
    )
    expect(state.targets).toEqual([serialTarget])
  })

  it("keeps the old SSH target when a serial target is added", () => {
    const state = remoteTargetsProjection.apply(
      { targets: [sshTarget] },
      resultEvent({ kind: "remote/target-added", target: serialTarget }),
    )
    expect(state.targets).toEqual([sshTarget, serialTarget])
  })
})

describe("remote_target_add transport arguments", () => {
  it("rejects SSH-only arguments on a serial target", async () => {
    const add = targetTool()
    await expect(
      add.execute(
        { name: "core-sw", transport: "serial", kind: "network", host: "example.com" },
        runContext(),
      ),
    ).rejects.toThrow(/host is only for the ssh transport/)
  })

  it("rejects serial-only arguments on an SSH target", async () => {
    const add = targetTool()
    await expect(
      add.execute(
        {
          name: "web1",
          transport: "ssh",
          kind: "linux",
          host: "example.com",
          agent: "lab-mac",
        },
        runContext(),
      ),
    ).rejects.toThrow(/agent is only for the serial transport/)
  })

  it("requires agent and device for a serial target", async () => {
    const add = targetTool()
    await expect(
      add.execute({ name: "core-sw", transport: "serial", kind: "network" }, runContext()),
    ).rejects.toThrow(/agent is required/)
  })

  it("requires host for an SSH target", async () => {
    const add = targetTool()
    await expect(
      add.execute({ name: "web1", transport: "ssh", kind: "linux" }, runContext()),
    ).rejects.toThrow(/host is required/)
  })

  it("reports an offline agent before asking the user anything", async () => {
    const agent = makeAgent()
    const add = targetTool(new SerialAgents([agent.authorized]))
    await expect(
      add.execute(
        {
          name: "core-sw",
          transport: "serial",
          kind: "network",
          agent: agent.name,
          device: "/dev/ttyUSB0",
        },
        runContext(),
      ),
    ).rejects.toThrow(/offline/)
  })
})

function resultEvent(meta: unknown, isError = false): SessionEvent {
  return {
    type: "tool/result",
    seq: 1,
    time: 0,
    surfaceOp: "append",
    data: {
      turn: 0,
      step: 0,
      message: { role: "tool", callId: "call", content: [], isError },
      meta,
    },
  } as unknown as SessionEvent
}

const root = { id: "root" } as Agent

function runContext(): ToolRunContext {
  return {
    agent: root,
    callId: "call-1",
    signal: new AbortController().signal,
  } as ToolRunContext
}

function targetTool(serial = new SerialAgents([])): ToolDefinition {
  const registered = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
    agents: {
      list: () => [root],
      isOwnedBy: () => false,
    },
    logger: { warn: () => {}, error: () => {} },
  } as unknown as Context
  const runtime = {
    root,
    sessionId: root.id,
    find: () => undefined,
    prompter: () => {
      throw new Error("The test did not expect a user card")
    },
    transportFor: () => {
      throw new Error("The test did not expect a transport")
    },
  } as unknown as RootRuntime
  const host = {
    config: {
      sshPath: "ssh",
      controlPersistSeconds: 600,
      execTimeoutMs: 120_000,
      execMaxTimeoutMs: 600_000,
      maxOutputBytes: 30_000,
      blockedSshOptions: [],
      defaultPromptPattern: "[>#$%]\\s*$",
      sessionIdleMs: 2000,
      sessionSendTimeoutMs: 30_000,
      maxSecretRetries: 2,
      serialRequestTimeoutMs: 10_000,
      serialReplayBytes: 4096,
    },
    handle: { stateOf: () => ({ targets: [] as RemoteTarget[] }) },
    secrets: new SecretStore(),
    serial,
    runtimeFor: () => runtime,
  } as unknown as HostRuntime
  registerTargetTools(ctx, host)
  const add = registered.get("remote_target_add")
  if (add === undefined) throw new Error("remote_target_add was not registered")
  return add
}
