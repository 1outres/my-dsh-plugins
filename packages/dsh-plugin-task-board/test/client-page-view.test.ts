import { describe, expect, it } from "vitest"
import { noticeView, pageView, projectOf, reconcileSelection } from "../src/client/page-view"
import type { BoardState } from "../src/client/state/board"
import type { ProjectsState } from "../src/client/state/project-list"
import { OTHER_PROJECT, PROJECT, SNAPSHOT, translate } from "./client-support"

const READY: ProjectsState = { status: "ready", items: [PROJECT], requestedFor: PROJECT.path }
const LOADING: ProjectsState = { status: "loading", items: [], requestedFor: undefined }
const BOARD_LOADING: BoardState = {
  project: PROJECT.path,
  status: "loading",
  snapshot: undefined,
  error: undefined,
}
const BOARD_READY: BoardState = {
  project: PROJECT.path,
  status: "ready",
  snapshot: SNAPSHOT,
  error: undefined,
}
const OFFLINE = { code: "transport", message: "offline" }

describe("page view", () => {
  it("shows skeletons while projects or the board load", () => {
    expect(pageView(LOADING, BOARD_LOADING)).toEqual({ kind: "loading" })
    expect(pageView(READY, BOARD_LOADING)).toEqual({ kind: "loading" })
  })

  it("shows the empty state without projects", () => {
    expect(pageView({ ...READY, items: [] }, BOARD_LOADING)).toEqual({ kind: "noProjects" })
  })

  it("shows the board when a snapshot exists, also after a stream error", () => {
    expect(pageView(READY, BOARD_READY)).toEqual({ kind: "board", snapshot: SNAPSHOT })
    expect(pageView(READY, { ...BOARD_READY, status: "error", error: OFFLINE })).toEqual({
      kind: "board",
      snapshot: SNAPSHOT,
    })
  })

  it("shows nothing under the notice when loading failed", () => {
    expect(pageView(READY, { ...BOARD_LOADING, status: "error", error: OFFLINE })).toEqual({
      kind: "blank",
    })
    expect(
      pageView(
        { status: "error", items: [], message: "down", requestedFor: undefined },
        BOARD_LOADING,
      ),
    ).toEqual({ kind: "blank" })
  })
})

describe("notice", () => {
  it("shows nothing when all is well", () => {
    expect(noticeView(READY, BOARD_READY, undefined, translate)).toBeUndefined()
  })

  it("offers a board retry when the board failed", () => {
    expect(
      noticeView(READY, { ...BOARD_READY, status: "error", error: OFFLINE }, undefined, translate),
    ).toEqual({ messages: ["Could not load the board: offline"], retry: "board" })
  })

  it("offers a project retry when the projects failed", () => {
    expect(
      noticeView(
        { status: "error", items: [], message: "down", requestedFor: undefined },
        BOARD_LOADING,
        undefined,
        translate,
      ),
    ).toEqual({ messages: ["Could not load projects: down"], retry: "projects" })
  })

  it("shows a failed action without a retry", () => {
    expect(noticeView(READY, BOARD_READY, "Could not save the change: nope", translate)).toEqual({
      messages: ["Could not save the change: nope"],
      retry: undefined,
    })
  })
})

describe("selection", () => {
  it("waits for the project list", () => {
    expect(reconcileSelection(LOADING, undefined)).toEqual({ kind: "none" })
  })

  it("selects the first project when none is selected", () => {
    expect(reconcileSelection(READY, undefined)).toEqual({ kind: "select", project: PROJECT.path })
  })

  it("keeps a listed selection", () => {
    expect(reconcileSelection(READY, PROJECT.path)).toEqual({ kind: "none" })
  })

  it("reloads the list once for a selection it does not know", () => {
    expect(reconcileSelection(READY, OTHER_PROJECT.path)).toEqual({ kind: "reload" })
  })

  it("replaces a selection the reloaded list still does not know", () => {
    expect(
      reconcileSelection({ ...READY, requestedFor: OTHER_PROJECT.path }, OTHER_PROJECT.path),
    ).toEqual({ kind: "select", project: PROJECT.path })
  })

  it("clears the selection when there are no projects", () => {
    expect(
      reconcileSelection({ status: "ready", items: [], requestedFor: PROJECT.path }, PROJECT.path),
    ).toEqual({ kind: "select", project: undefined })
    expect(
      reconcileSelection({ status: "ready", items: [], requestedFor: undefined }, undefined),
    ).toEqual({ kind: "none" })
  })

  it("finds the selected project", () => {
    expect(projectOf([PROJECT, OTHER_PROJECT], OTHER_PROJECT.path)).toBe(OTHER_PROJECT)
    expect(projectOf([PROJECT], undefined)).toBeUndefined()
  })
})
