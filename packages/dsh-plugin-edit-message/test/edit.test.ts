import { describe, expect, it } from "vitest"
import { type EditDeps, type EditRequest, runEdit } from "../src/client/edit"
import type {
  PromptContentPart,
  RemoteResult,
  SessionBinding,
  SessionEvent,
  SessionFace,
} from "../src/client/types"

const OK: RemoteResult<unknown> = { ok: true, value: { accepted: true } }

function failure(message: string): RemoteResult<never> {
  return { ok: false, error: { code: "x", message } }
}

function events(types: string[], base = 0): SessionEvent[] {
  return types.map((type, index) => ({
    type,
    seq: base + index,
    ...(type === "user/message" ? { surfaceOp: "append" } : {}),
  }))
}

/** A two-turn source log: turn 2 starts at seq 11, after a title event at 9. */
const SOURCE_LOG = events([
  "permission/preset", // 0
  "agent/inbox/spliced", // 1
  "turn/start", // 2
  "agent/inbox/spliced", // 3
  "step/start", // 4
  "user/message", // 5
  "assistant/message", // 6
  "step/end", // 7
  "turn/end", // 8
  "session/title", // 9
  "agent/inbox/spliced", // 10
  "turn/start", // 11
  "agent/inbox/spliced", // 12
  "step/start", // 13
  "user/message", // 14
])

interface Options {
  running?: boolean
  window?: SessionEvent[]
  inbox?: unknown
  refreshedInbox?: unknown
  forkError?: Error
  promptResult?: RemoteResult<unknown>
  removeResult?: RemoteResult<unknown>
  attachment?: RemoteResult<{
    attachment: { attachmentId: string; mediaType: string; name?: string }
    data: Uint8Array
  }>
  title?: string
  workspaces?: boolean
}

function harness(options: Options = {}) {
  const calls: string[] = []
  const prompts: PromptContentPart[][] = []
  let window = options.window ?? SOURCE_LOG
  let childInbox = options.inbox

  const observable = <T>(read: () => T) => ({ getSnapshot: read, subscribe: () => () => {} })

  const face = (id: string, extra: Partial<SessionFace>): SessionFace => ({
    sessionId: id,
    getSnapshot: () => ({ running: id === "src" && options.running === true, subagent: null }),
    subscribe: () => () => {},
    projections: { faceOf: () => observable(() => (id === "child" ? childInbox : undefined)) },
    prompt: async () => OK,
    readAttachment: async () => failure("unexpected"),
    updateQueue: async () => OK,
    rename: async () => OK,
    loadThrough: async () => {},
    ...extra,
  })

  const source: SessionBinding = {
    sessionId: "src",
    eventSource: observable(() => ({
      entries: window.map((event) => ({ type: "event" as const, event })),
      hasMore: false,
    })),
    session: face("src", {
      loadThrough: async (seq) => {
        calls.push(`loadThrough:${seq}`)
        window = SOURCE_LOG
      },
      readAttachment: async (id) => {
        calls.push(`readAttachment:${id}`)
        return options.attachment ?? failure("missing")
      },
    }),
  }

  const child: SessionBinding = {
    sessionId: "child",
    eventSource: observable(() => ({ entries: [], hasMore: false })),
    session: face("child", {
      updateQueue: async (id) => {
        calls.push(`remove:${id}`)
        return options.removeResult ?? OK
      },
      rename: async (title) => {
        calls.push(`rename:${title}`)
        return OK
      },
      prompt: async (content, mode) => {
        calls.push(`prompt:${mode}`)
        prompts.push(content)
        return options.promptResult ?? OK
      },
    }),
  }

  const deps: EditDeps = {
    sessions: {
      list: observable(() => ({
        byId: { src: options.title === undefined ? {} : { title: options.title } },
        projectionsBySession: {},
      })),
      binding: (id) => (id === "src" ? source : undefined),
      retain: (id, { source: label }) => {
        calls.push(`retain:${id}:${label}`)
        return {
          ready: Promise.resolve(child),
          release: () => {
            calls.push(`release:${id}`)
          },
        }
      },
      fork: async (request) => {
        calls.push(`fork:${request.sessionId}@${request.atSeq}:${request.increaseTitle}`)
        if (options.forkError !== undefined) throw options.forkError
        return "child"
      },
      refreshProjections: async (id) => {
        calls.push(`refresh:${id}`)
        childInbox = options.refreshedInbox
      },
    },
    uiWorkspace: {
      openSession: (id) => {
        calls.push(`open:${id}`)
      },
      archiveSession: async (id) => {
        calls.push(`archive:${id}`)
      },
    },
    ...(options.workspaces === false
      ? {}
      : {
          workspaces: {
            list: observable(() => ({ items: [{ workspaceId: "w1", sessionIds: ["src"] }] })),
            insertSessionBefore: async (workspaceId, sessionId, before) => {
              calls.push(`place:${workspaceId}:${sessionId}<${before}`)
            },
          },
        }),
  }
  return { deps, calls, prompts }
}

const TURN_TWO: EditRequest = {
  sessionId: "src",
  turn: 2,
  turnStartSeq: 11,
  content: [{ type: "text", text: "original" }],
  text: "edited",
}

describe("runEdit", () => {
  it("forks before the turn, sends there, then opens the fork and archives the original", async () => {
    const { deps, calls, prompts } = harness({
      title: "My chat",
      inbox: { "next-turn": [], "next-step": [] },
    })
    await expect(runEdit(deps, TURN_TWO)).resolves.toEqual({ ok: true, sessionId: "child" })
    expect(calls).toEqual([
      "fork:src@9:false",
      "retain:child:controllerOperation",
      "rename:My chat",
      "prompt:queue",
      "place:w1:child<src",
      "open:child",
      "release:child",
      "archive:src",
    ])
    expect(prompts).toEqual([[{ type: "text", text: "edited" }]])
  })

  it("leaves the title to automatic naming when the first prompt is edited", async () => {
    const { deps, calls } = harness({ title: "Old topic" })
    await runEdit(deps, { ...TURN_TWO, turn: 1, turnStartSeq: 2 })
    expect(calls[0]).toBe("fork:src@0:false")
    expect(calls.some((call) => call.startsWith("rename:"))).toBe(false)
  })

  it("removes queue items the fork inherited before sending", async () => {
    const { deps, calls } = harness({
      refreshedInbox: { "next-turn": [{ id: "m1" }], "next-step": [{ id: "m2" }] },
    })
    await runEdit(deps, TURN_TWO)
    const sendAt = calls.indexOf("prompt:queue")
    expect(calls.indexOf("refresh:child")).toBeLessThan(sendAt)
    expect(calls.indexOf("remove:m1")).toBeLessThan(sendAt)
    expect(calls.indexOf("remove:m2")).toBeLessThan(sendAt)
  })

  it("pages older history when the window starts at the edited turn", async () => {
    const { deps, calls } = harness({ window: SOURCE_LOG.slice(11) })
    await runEdit(deps, TURN_TWO)
    expect(calls.slice(0, 2)).toEqual(["loadThrough:10", "fork:src@9:false"])
  })

  it("sends the original images again after the edited text", async () => {
    const { deps, prompts } = harness({
      attachment: {
        ok: true,
        value: {
          attachment: { attachmentId: "img", mediaType: "image/png", name: "a.png" },
          data: new Uint8Array([104, 105]),
        },
      },
    })
    await runEdit(deps, {
      ...TURN_TWO,
      content: [
        { type: "text", text: "look" },
        {
          type: "image",
          attachment: {
            attachmentId: "img",
            mediaType: "image/png",
            bytes: 2,
            width: 1,
            height: 1,
          },
        },
      ],
    })
    expect(prompts[0]).toEqual([
      { type: "text", text: "edited" },
      { type: "image", mediaType: "image/png", data: "aGk=", name: "a.png" },
    ])
  })

  it("refuses while the source runs, for empty text, and for file attachments", async () => {
    expect(await runEdit(harness({ running: true }).deps, TURN_TWO)).toEqual({
      ok: false,
      reason: "running",
    })
    expect(await runEdit(harness().deps, { ...TURN_TWO, text: "  " })).toEqual({
      ok: false,
      reason: "empty",
    })
    const files = harness()
    expect(
      await runEdit(files.deps, {
        ...TURN_TWO,
        content: [{ type: "file", attachment: { attachmentId: "f" } }],
      }),
    ).toEqual({ ok: false, reason: "files" })
    expect(files.calls).toEqual([])
  })

  it("does not fork when an image cannot be read", async () => {
    const { deps, calls } = harness()
    const outcome = await runEdit(deps, {
      ...TURN_TWO,
      content: [{ type: "image", attachment: { attachmentId: "gone", mediaType: "image/png" } }],
    })
    expect(outcome).toEqual({ ok: false, reason: "attachment", detail: "missing" })
    expect(calls).toEqual(["readAttachment:gone"])
  })

  it("touches nothing when the fork fails", async () => {
    const { deps, calls } = harness({
      forkError: Object.assign(new Error("fork failed"), { rpcError: { message: "busy" } }),
    })
    expect(await runEdit(deps, TURN_TWO)).toEqual({ ok: false, reason: "fork", detail: "busy" })
    expect(calls).toEqual(["fork:src@9:false"])
  })

  it("archives the unused fork and keeps the original when the prompt is refused", async () => {
    const { deps, calls } = harness({ promptResult: failure("quota") })
    expect(await runEdit(deps, TURN_TWO)).toEqual({ ok: false, reason: "prompt", detail: "quota" })
    expect(calls).toContain("archive:child")
    expect(calls).not.toContain("archive:src")
    expect(calls).not.toContain("open:child")
    expect(calls).toContain("release:child")
  })

  it("archives the unused fork when an inherited queue item cannot be removed", async () => {
    const { deps, calls } = harness({
      inbox: { "next-turn": [{ id: "m1" }], "next-step": [] },
      removeResult: failure("gone"),
    })
    expect(await runEdit(deps, TURN_TWO)).toEqual({ ok: false, reason: "prepare", detail: "gone" })
    expect(calls).not.toContain("prompt:queue")
    expect(calls).toContain("archive:child")
    expect(calls).not.toContain("archive:src")
  })

  it("still opens the fork when the Workspace service is missing", async () => {
    const { deps, calls } = harness({ workspaces: false })
    await expect(runEdit(deps, TURN_TWO)).resolves.toEqual({ ok: true, sessionId: "child" })
    expect(calls).toContain("open:child")
    expect(calls.some((call) => call.startsWith("place:"))).toBe(false)
  })
})
