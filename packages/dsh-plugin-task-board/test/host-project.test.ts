import { describe, expect, it } from "vitest"
import { createProjectResolver, normalizeProjectPath } from "../src/host/project"
import { createFakeFileSystem, createFakeWorkspaces, projectSummary } from "./host-support"

const REPO_FILES = {
  "/repo": { kind: "directory" as const },
  "/repo/.git": { kind: "directory" as const },
  "/repo/src": { kind: "directory" as const },
  "/repo/src/index.ts": { kind: "file" as const },
}

function repoWorkspaces() {
  return createFakeWorkspaces([
    { id: "w1", path: "/repo", title: "Repo" },
    { id: "w2", path: "/other", title: "Other" },
  ])
}

describe("normalizeProjectPath", () => {
  it("strips trailing separators", () => {
    expect(normalizeProjectPath("/repo/")).toBe("/repo")
    expect(normalizeProjectPath("/repo///")).toBe("/repo")
    expect(normalizeProjectPath("/repo")).toBe("/repo")
  })

  it("keeps a filesystem root and rejects an empty path", () => {
    expect(normalizeProjectPath("/")).toBe("/")
    expect(normalizeProjectPath("")).toBeUndefined()
  })
})

describe("createProjectResolver", () => {
  it("lists every workspace with a normalized path", () => {
    const workspaces = createFakeWorkspaces([
      { id: "w1", path: "/repo/", title: "Repo" },
      { id: "w2", path: "/other", title: "Other" },
    ])
    const resolver = createProjectResolver(workspaces, createFakeFileSystem(REPO_FILES))

    expect(resolver.projects()).toEqual([
      { path: "/repo", title: "Repo", workspaceId: "w1" },
      { path: "/other", title: "Other", workspaceId: "w2" },
    ])
  })

  it("looks up a known project by its normalized path", () => {
    const resolver = createProjectResolver(repoWorkspaces(), createFakeFileSystem(REPO_FILES))

    expect(resolver.project("/repo/")).toEqual(
      projectSummary("/repo", {
        title: "Repo",
        workspaceId: "w1",
      }),
    )
    expect(resolver.project("/repo/src")).toBeUndefined()
  })

  it("resolves a nested directory to its repository workspace", async () => {
    const resolver = createProjectResolver(repoWorkspaces(), createFakeFileSystem(REPO_FILES))

    const outcome = await resolver.resolveDirectory("/repo/src")

    expect(outcome).toEqual({
      status: "ok",
      value: { path: "/repo", title: "Repo", workspaceId: "w1" },
    })
  })

  it("uses the real path of a symlinked directory", async () => {
    const resolver = createProjectResolver(
      repoWorkspaces(),
      createFakeFileSystem(REPO_FILES, { "/repo/link": "/repo/src" }),
    )

    const outcome = await resolver.resolveDirectory("/repo/link")

    expect(outcome.status).toBe("ok")
    expect(outcome.status === "ok" ? outcome.value.path : undefined).toBe("/repo")
  })

  it("maps a linked worktree of a repository to the main checkout", async () => {
    const files = {
      "/repo": { kind: "directory" as const },
      "/repo/.git": { kind: "directory" as const },
      "/repo/.git/worktrees": { kind: "directory" as const },
      "/repo/.git/worktrees/feat": { kind: "directory" as const },
      "/repo/.git/worktrees/feat/commondir": { kind: "file" as const, text: "../..\n" },
      "/repo/.worktrees": { kind: "directory" as const },
      "/repo/.worktrees/feat": { kind: "directory" as const },
      "/repo/.worktrees/feat/.git": {
        kind: "file" as const,
        text: "gitdir: /repo/.git/worktrees/feat\n",
      },
      "/repo/.worktrees/feat/src": { kind: "directory" as const },
    }
    const resolver = createProjectResolver(repoWorkspaces(), createFakeFileSystem(files))

    const nested = await resolver.resolveDirectory("/repo/.worktrees/feat/src")
    const root = await resolver.resolveDirectory("/repo/.worktrees/feat")

    expect(nested.status === "ok" ? nested.value.path : undefined).toBe("/repo")
    expect(root.status === "ok" ? root.value.path : undefined).toBe("/repo")
  })

  it("maps a worktree outside the main checkout to the main checkout", async () => {
    const files = {
      "/main": { kind: "directory" as const },
      "/main/.git": { kind: "directory" as const },
      "/main/.git/worktrees": { kind: "directory" as const },
      "/main/.git/worktrees/feat": { kind: "directory" as const },
      "/main/.git/worktrees/feat/commondir": { kind: "file" as const, text: "../.." },
      "/worktrees": { kind: "directory" as const },
      "/worktrees/feat": { kind: "directory" as const },
      "/worktrees/feat/.git": {
        kind: "file" as const,
        text: "gitdir: /main/.git/worktrees/feat",
      },
    }
    const workspaces = createFakeWorkspaces([{ id: "w1", path: "/main", title: "Main" }])
    const resolver = createProjectResolver(workspaces, createFakeFileSystem(files))

    const outcome = await resolver.resolveDirectory("/worktrees/feat")

    expect(outcome.status === "ok" ? outcome.value.path : undefined).toBe("/main")
  })

  it("resolves a relative gitdir against the worktree root", async () => {
    const files = {
      "/repo": { kind: "directory" as const },
      "/repo/.git": { kind: "directory" as const },
      "/repo/.git/worktrees": { kind: "directory" as const },
      "/repo/.git/worktrees/feat": { kind: "directory" as const },
      "/repo/.git/worktrees/feat/commondir": { kind: "file" as const, text: "../.." },
      "/repo/.worktrees": { kind: "directory" as const },
      "/repo/.worktrees/feat": { kind: "directory" as const },
      "/repo/.worktrees/feat/.git": {
        kind: "file" as const,
        text: "gitdir: ../../.git/worktrees/feat",
      },
    }
    const resolver = createProjectResolver(repoWorkspaces(), createFakeFileSystem(files))

    const outcome = await resolver.resolveDirectory("/repo/.worktrees/feat")

    expect(outcome.status === "ok" ? outcome.value.path : undefined).toBe("/repo")
  })

  it("keeps the worktree itself when the common dir is not a .git directory", async () => {
    const files = {
      "/bare": { kind: "directory" as const },
      "/bare/worktrees": { kind: "directory" as const },
      "/bare/worktrees/wt": { kind: "directory" as const },
      "/bare/worktrees/wt/.git": {
        kind: "file" as const,
        text: "gitdir: /bare/worktrees/wt",
      },
      "/bare/worktrees/wt/commondir": { kind: "file" as const, text: "/bare" },
    }
    const workspaces = createFakeWorkspaces([{ id: "w1", path: "/bare/worktrees/wt", title: "wt" }])
    const resolver = createProjectResolver(workspaces, createFakeFileSystem(files))

    const outcome = await resolver.resolveDirectory("/bare/worktrees/wt")

    expect(outcome.status === "ok" ? outcome.value.path : undefined).toBe("/bare/worktrees/wt")
  })

  it("picks the longest ancestor workspace when no git checkout exists", async () => {
    const workspaces = createFakeWorkspaces([
      { id: "w1", path: "/work", title: "Work" },
      { id: "w2", path: "/work/project", title: "Project" },
    ])
    const files = {
      "/work": { kind: "directory" as const },
      "/work/project": { kind: "directory" as const },
      "/work/project/src": { kind: "directory" as const },
    }
    const resolver = createProjectResolver(workspaces, createFakeFileSystem(files))

    const outcome = await resolver.resolveDirectory("/work/project/src")

    expect(outcome.status === "ok" ? outcome.value.workspaceId : undefined).toBe("w2")
  })

  it("does not treat a path prefix as an ancestor", async () => {
    const workspaces = createFakeWorkspaces([
      { id: "w1", path: "/work", title: "Work" },
      { id: "w2", path: "/workshop", title: "Workshop" },
    ])
    const files = {
      "/workshop": { kind: "directory" as const },
      "/workshop/src": { kind: "directory" as const },
    }
    const resolver = createProjectResolver(workspaces, createFakeFileSystem(files))

    const outcome = await resolver.resolveDirectory("/workshop/src")

    expect(outcome.status === "ok" ? outcome.value.workspaceId : undefined).toBe("w2")
  })

  it("returns project_not_found when no workspace contains the directory", async () => {
    const files = {
      "/elsewhere": { kind: "directory" as const },
      "/elsewhere/src": { kind: "directory" as const },
    }
    const resolver = createProjectResolver(repoWorkspaces(), createFakeFileSystem(files))

    const outcome = await resolver.resolveDirectory("/elsewhere/src")

    expect(outcome).toEqual({
      status: "error",
      error: {
        code: "project_not_found",
        message: "No project is registered for /elsewhere/src.",
      },
    })
  })

  it("returns project_not_found when the directory cannot be read", async () => {
    const resolver = createProjectResolver(repoWorkspaces(), createFakeFileSystem(REPO_FILES))

    const outcome = await resolver.resolveDirectory("/missing")

    expect(outcome.status).toBe("error")
    expect(outcome.status === "error" ? outcome.error.code : undefined).toBe("project_not_found")
  })

  it("rejects an invalid .git file instead of guessing", async () => {
    const workspaces = createFakeWorkspaces([{ id: "w1", path: "/repo", title: "Repo" }])
    const files = {
      "/repo": { kind: "directory" as const },
      "/repo/.git": { kind: "file" as const, text: "not a gitdir" },
    }
    const resolver = createProjectResolver(workspaces, createFakeFileSystem(files))

    await expect(resolver.resolveDirectory("/repo")).rejects.toThrow(/invalid \.git file/iu)
  })
})
