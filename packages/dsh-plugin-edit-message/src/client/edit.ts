import { durableEvents, forkBoundary } from "./boundary"
import { bytesToBase64, type LoadedImage, messageParts, promptContent } from "./content"
import type {
  ContentBlock,
  SessionBinding,
  SessionsService,
  UiWorkspaceService,
  WorkspacesService,
} from "./types"

/** One edit of a turn-opening user message. */
export interface EditRequest {
  /** Session showing the message. */
  sessionId: string
  /** Turn number the message opens. */
  turn: number
  /** Seq of that turn's `turn/start`. */
  turnStartSeq: number
  /** The original message content; its images are sent again. */
  content: readonly ContentBlock[]
  /** The edited text. */
  text: string
}

export type EditFailure =
  | "unavailable"
  | "running"
  | "empty"
  | "files"
  | "boundary"
  | "attachment"
  | "fork"
  | "prepare"
  | "prompt"

export type EditOutcome =
  | { ok: true; sessionId: string }
  | { ok: false; reason: EditFailure; detail?: string }

export interface EditDeps {
  sessions: SessionsService
  uiWorkspace: UiWorkspaceService
  workspaces?: WorkspacesService | undefined
  warn?: (message: string, error?: unknown) => void
}

/** The reference source the Client offers for temporary controller work. */
export const REFERENCE_SOURCE = "controllerOperation"

/** History pages to load at most while looking for the previous turn's end. */
const MAX_HISTORY_LOADS = 3

class EditError extends Error {
  constructor(
    readonly reason: EditFailure,
    readonly detail?: string,
  ) {
    super(detail ?? reason)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const rpc = (error as Error & { rpcError?: { message?: unknown } }).rpcError
    if (typeof rpc?.message === "string" && rpc.message.length > 0) return rpc.message
    return error.message
  }
  return String(error)
}

function fail(reason: EditFailure, detail?: string): EditOutcome {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail }
}

/**
 * Resolve the inclusive seq to fork through, paging older history when the
 * loaded window does not reach the previous turn's end.
 */
async function resolveCut(source: SessionBinding, request: EditRequest): Promise<number> {
  for (let attempt = 0; attempt <= MAX_HISTORY_LOADS; attempt++) {
    const events = durableEvents(source.eventSource.getSnapshot().entries)
    const boundary = forkBoundary(events, request.turn, request.turnStartSeq)
    if (boundary.kind === "cut") return boundary.seq
    if (boundary.kind === "invalid" || attempt === MAX_HISTORY_LOADS) break
    const before = events[0]?.seq
    await source.session.loadThrough(boundary.through)
    const after = durableEvents(source.eventSource.getSnapshot().entries)[0]?.seq
    if (after === before) break
  }
  throw new EditError("boundary")
}

async function loadImages(source: SessionBinding, request: EditRequest): Promise<LoadedImage[]> {
  const images: LoadedImage[] = []
  for (const ref of messageParts(request.content).images) {
    const read = await source.session.readAttachment(ref.attachmentId)
    if (!read.ok) throw new EditError("attachment", read.error.message)
    const name = read.value.attachment.name ?? ref.name
    images.push({
      mediaType: read.value.attachment.mediaType,
      data: bytesToBase64(read.value.data),
      ...(name === undefined ? {} : { name }),
    })
  }
  return images
}

function pendingIds(inbox: unknown): string[] {
  if (typeof inbox !== "object" || inbox === null) return []
  const ids: string[] = []
  for (const target of ["next-turn", "next-step"]) {
    const items = (inbox as Record<string, unknown>)[target]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const id = (item as { id?: unknown } | null)?.id
      if (typeof id === "string" && id.length > 0) ids.push(id)
    }
  }
  return ids
}

/**
 * Drop queue items the fork inherited. A prompt queued while the previous turn
 * ran is recorded before that turn ended, so the cut carries it as pending
 * input that would otherwise run ahead of the edited message.
 */
async function clearInheritedQueue(sessions: SessionsService, child: SessionBinding) {
  let inbox = child.session.projections.faceOf("inbox").getSnapshot()
  if (inbox === undefined) {
    await sessions.refreshProjections(child.sessionId)
    inbox =
      child.session.projections.faceOf("inbox").getSnapshot() ??
      sessions.list.getSnapshot().projectionsBySession?.[child.sessionId]?.values?.inbox
  }
  for (const id of pendingIds(inbox)) {
    const removed = await child.session.updateQueue(id, { kind: "remove" })
    if (!removed.ok) throw new EditError("prepare", removed.error.message)
  }
}

async function placeBeside(deps: EditDeps, sourceId: string, childId: string) {
  const workspaces = deps.workspaces
  if (workspaces === undefined) return
  const owner = workspaces.list
    .getSnapshot()
    .items.find((item) => item.sessionIds.includes(sourceId))
  if (owner === undefined) return
  try {
    await workspaces.insertSessionBefore(owner.workspaceId, childId, sourceId)
  } catch (error) {
    deps.warn?.("edit-message: could not place the new session beside the original", error)
  }
}

/**
 * Edit a sent message: fork the Session just before the turn the message
 * opens, send the edited text there, then open the fork and archive the
 * original. Nothing changes on the original until the edited prompt is
 * accepted; a failure after the fork archives the fork instead.
 * @param deps - Client services.
 * @param request - the message and its edited text.
 * @returns the new Session id, or why the edit did not happen.
 */
export async function runEdit(deps: EditDeps, request: EditRequest): Promise<EditOutcome> {
  const source = deps.sessions.binding(request.sessionId)
  if (source === undefined) return fail("unavailable")
  if (source.session.getSnapshot().running) return fail("running")
  if (request.text.trim().length === 0) return fail("empty")
  if (messageParts(request.content).hasFiles) return fail("files")

  let cut: number
  try {
    cut = await resolveCut(source, request)
  } catch {
    return fail("boundary")
  }

  let images: LoadedImage[]
  try {
    images = await loadImages(source, request)
  } catch (error) {
    return fail("attachment", error instanceof EditError ? error.detail : describe(error))
  }

  let childId: string
  try {
    childId = await deps.sessions.fork({
      sessionId: request.sessionId,
      atSeq: cut,
      increaseTitle: false,
    })
  } catch (error) {
    return fail("fork", describe(error))
  }

  const reference = deps.sessions.retain(childId, { source: REFERENCE_SOURCE })
  try {
    const child = await reference.ready
    await clearInheritedQueue(deps.sessions, child)
    const title = deps.sessions.list.getSnapshot().byId[request.sessionId]?.title
    if (request.turn > 1 && title !== undefined && title.length > 0) {
      const renamed = await child.session.rename(title)
      if (!renamed.ok) deps.warn?.("edit-message: could not keep the title", renamed.error)
    }
    const sent = await child.session.prompt(promptContent(request.text, images), "queue")
    if (!sent.ok) throw new EditError("prompt", sent.error.message)
  } catch (error) {
    reference.release()
    try {
      await deps.uiWorkspace.archiveSession(childId)
    } catch (cleanup) {
      deps.warn?.("edit-message: could not archive the unused fork", cleanup)
    }
    if (error instanceof EditError) return fail(error.reason, error.detail)
    return fail("prepare", describe(error))
  }

  await placeBeside(deps, request.sessionId, childId)
  deps.uiWorkspace.openSession(childId)
  reference.release()
  try {
    await deps.uiWorkspace.archiveSession(request.sessionId)
  } catch (error) {
    deps.warn?.("edit-message: could not archive the original session", error)
  }
  return { ok: true, sessionId: childId }
}
