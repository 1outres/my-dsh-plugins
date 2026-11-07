import type { SessionEvent } from "@deepseek-ai/dsh-session"
import { describe, expect, it } from "vitest"
import { remoteTargetsProjection } from "../src/host/targets/projection"
import type { RemoteTarget } from "../src/shared/types"

const target: RemoteTarget = {
  name: "web1",
  transport: "ssh",
  kind: "linux",
  host: "example.com",
  sshOptions: [],
  secrets: ["login"],
  initCommands: [],
}

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
      ...(isError ? {} : {}),
      meta,
    },
  } as unknown as SessionEvent
}

function dispatchEvent(meta: unknown, isError = false): SessionEvent {
  return {
    type: "tool/ptc-dispatch",
    seq: 2,
    time: 0,
    data: {
      rootCallId: "root",
      parentCallId: "root",
      subCallId: "root:ptc:1",
      name: "remote_target_add",
      arguments: {},
      isError,
      content: [],
      meta,
    },
  } as unknown as SessionEvent
}

describe("remote targets projection", () => {
  it("starts empty", () => {
    expect(remoteTargetsProjection.init({} as never, 0 as never)).toEqual({ targets: [] })
  })

  it("adds a target from a successful result", () => {
    const state = remoteTargetsProjection.apply(
      { targets: [] },
      resultEvent({ kind: "remote/target-added", target }),
    )
    expect(state.targets).toEqual([target])
  })

  it("ignores failed results and unrelated meta", () => {
    expect(
      remoteTargetsProjection.apply(
        { targets: [] },
        resultEvent({ kind: "remote/target-added", target }, true),
      ),
    ).toEqual({ targets: [] })
    expect(remoteTargetsProjection.apply({ targets: [] }, resultEvent({ kind: "other" }))).toEqual({
      targets: [],
    })
  })

  it("adds a target dispatched by the programmatic caller", () => {
    const state = remoteTargetsProjection.apply(
      { targets: [] },
      dispatchEvent({ kind: "remote/target-added", target }),
    )
    expect(state.targets).toEqual([target])
  })

  it("ignores a failed dispatch", () => {
    expect(
      remoteTargetsProjection.apply(
        { targets: [] },
        dispatchEvent({ kind: "remote/target-added", target }, true),
      ),
    ).toEqual({ targets: [] })
  })

  it("removes a target dispatched by the programmatic caller", () => {
    const state = remoteTargetsProjection.apply(
      { targets: [target] },
      dispatchEvent({ kind: "remote/target-removed", name: "web1" }),
    )
    expect(state.targets).toEqual([])
  })

  it("removes a target and keeps untouched state identical", () => {
    const state = { targets: [target] }
    expect(
      remoteTargetsProjection.apply(
        state,
        resultEvent({ kind: "remote/target-removed", name: "web1" }),
      ),
    ).toEqual({ targets: [] })
    expect(
      remoteTargetsProjection.apply(
        state,
        resultEvent({ kind: "remote/target-removed", name: "other" }),
      ),
    ).toBe(state)
  })

  it("replaces a repeated name instead of duplicating it", () => {
    const updated = { ...target, host: "example.org" }
    const state = remoteTargetsProjection.apply(
      { targets: [target] },
      resultEvent({ kind: "remote/target-added", target: updated }),
    )
    expect(state.targets).toEqual([updated])
  })
})
