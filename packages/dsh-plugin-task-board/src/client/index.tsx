import { TASK_BOARD_COMMAND } from "../shared/remote"
import { BoardPage, type BoardPageInjected } from "./BoardPage"
import { createTaskBoardBridge } from "./bridge"
import { en, ja } from "./i18n"
import { SessionBoardButton, type SessionBoardButtonInjected } from "./SessionBoardButton"
import { createBoardStore } from "./state/board"
import { browserStorage, createProjectStore } from "./state/projects"
import { TB_CSS } from "./styles"
import { TaskBoardIcon } from "./TaskBoardIcon"
import { runTaskCommand } from "./task-command"
import { buildTaskOptions } from "./task-options"
import type { ClientContext, CommandUiContract } from "./types"

export const inject = ["slots", "locale", "remote", "layout"]

export const NAMESPACE = "task-board"

export const PANEL_ID = "task-board"

const PANEL_ORDER = 20
const HEADER_ORDER = -4
const PLUGIN_ID = "@1outres/dsh-plugin-task-board"

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja }), "task-board: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/task-board.css`
    tag.textContent = TB_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "task-board: stylesheet")

  const bridge = createTaskBoardBridge(ctx)
  ctx.effect(() => () => bridge.dispose(), "task-board: remote")

  const projects = createProjectStore(browserStorage())
  const board = createBoardStore()

  const openBoardForSession = async (sessionId: string): Promise<void> => {
    const result = await bridge.projectOfSession(sessionId)
    if (result.status === "error") throw new Error(result.error.message)
    projects.select(result.value.path)
    ctx.layout.selectPanel(PANEL_ID)
  }

  const page: BoardPageInjected = { bridge, projects, board, t }
  ctx.effect(
    () =>
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NAMESPACE,
            inject: () => page,
          },
          BoardPage,
        ),
      ),
    "task-board: main panel",
  )

  ctx.effect(
    () =>
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: PANEL_ORDER,
            locale: NAMESPACE,
            label: () => t("panel"),
          },
          TaskBoardIcon,
        ),
      ),
    "task-board: sidebar entry",
  )

  ctx.effect(
    () =>
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: PANEL_ID,
            order: HEADER_ORDER,
            locale: NAMESPACE,
            inject: (sessionId: string): SessionBoardButtonInjected => ({
              sessionId,
              open: openBoardForSession,
              t,
            }),
          },
          SessionBoardButton,
        ),
      ),
    "task-board: session header",
  )

  ctx.inject(["commandUi"], (scope) => {
    const commandUi = scope.get("commandUi") as CommandUiContract | undefined
    if (commandUi === undefined)
      throw new Error("task-board: the commandUi service is not available")
    scope.effect(
      () =>
        commandUi.decorate({
          name: TASK_BOARD_COMMAND,
          available: (session) => session.sessionId.length > 0,
          ui: {
            kind: "popupSelect",
            searchMode: "substring",
            searchLabels: () => ({
              placeholder: t("task.searchPlaceholder"),
              empty: t("task.empty"),
              noResults: t("task.noResults"),
            }),
            options: async (session) => {
              const result = await bridge.boardOfSession(session.sessionId)
              if (result.status === "error") {
                throw new Error(t("task.boardFailed", { message: result.error.message }))
              }
              return buildTaskOptions(result.value.snapshot, t)
            },
            onSelect: async (option, session) => {
              await runTaskCommand({
                commands: ctx.remote.commands,
                sessionId: session.sessionId,
                optionId: option.id,
                t,
              })
            },
          },
        }),
      "task-board: /task decoration",
    )
  })
}
