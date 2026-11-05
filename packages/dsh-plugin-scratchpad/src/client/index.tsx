import { isRootPath, resolveRoot } from "../shared/paths"
import { NewScratchChip, NewScratchFooterButton, type StarterFace } from "./components"
import { en } from "./i18n"
import { IconScratch } from "./icons"
import { createScratchStarter, waitForWorkspace } from "./scratch"
import { SCRATCH_CSS } from "./styles"
import type { ClientContext, ScratchpadConfig } from "./types"

/** Cordis services required by the browser half. `commandUi` is optional. */
export const inject = [
  "slots",
  "locale",
  "configForms",
  "sessions",
  "workspaces",
  "uiWorkspace",
  "remote",
]

const PLUGIN_ID = "@1outres/dsh-plugin-scratchpad"

/** Locale namespace, and the settings entry id the Host half reads. */
export const NAMESPACE = "scratchpad"

export const FOOTER_SLOT = "sidebar.footer.action"
export const HERO_SLOT = "conversation.hero.options"
export const COMMAND = "scratch"

/**
 * Browser half: a "New scratch" button at the sidebar foot, a `/scratch`
 * command, and a chip on the blank Session of the root Workspace. Each opens
 * the newest scratch while it is unused, or creates a new one.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en }), "scratchpad: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/scratch.css`
    tag.textContent = SCRATCH_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "scratchpad: stylesheet")

  const t = ctx.locale.bind(NAMESPACE)
  const settings = ctx.configForms.get<ScratchpadConfig>(NAMESPACE)
  ctx.effect(() => settings.subscribe(() => {}), "scratchpad: settings")
  const root = () => resolveRoot(settings.getSnapshot().value?.root, ctx.remote.$host.home)

  const starter = createScratchStarter(
    {
      root,
      workspaces: () => ctx.workspaces.list.getSnapshot(),
      sessions: () => ctx.sessions.list.getSnapshot(),
      createSession: (cwd) => ctx.sessions.create({ cwd }),
      openWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
      openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
      waitForWorkspace: (sessionId, timeoutMs) =>
        waitForWorkspace(ctx.workspaces.list, sessionId, timeoutMs),
      now: () => new Date(),
    },
    { t, warn: (message, error) => console.warn(message, error) },
  )
  ctx.effect(() => () => starter.dispose(), "scratchpad: starter")
  const face: StarterFace = { start: () => starter.start(), status: starter.status }

  ctx.effect(
    () =>
      ctx.slots.inject(FOOTER_SLOT, () =>
        ctx.slots.register(
          { name: FOOTER_SLOT, id: "scratchpad", locale: NAMESPACE, inject: () => face },
          NewScratchFooterButton,
        ),
      ),
    "scratchpad: sidebar button",
  )

  ctx.effect(
    () =>
      ctx.slots.inject(HERO_SLOT, () =>
        ctx.slots.register(
          {
            name: HERO_SLOT,
            id: "scratchpad",
            locale: NAMESPACE,
            inject: (sessionId: string) => ({
              ...face,
              sessionId,
              sessions: ctx.sessions.list,
              isRoot: (cwd: string | undefined) => {
                const resolved = root()
                return resolved !== undefined && isRootPath(cwd, [resolved])
              },
            }),
          },
          NewScratchChip,
        ),
      ),
    "scratchpad: new session chip",
  )

  ctx.inject(["commandUi"], (child) => {
    const commandUi = child.commandUi
    if (commandUi === undefined) return
    child.effect(
      () =>
        commandUi.register({
          name: COMMAND,
          label: () => t("command.label"),
          description: () => t("command.description"),
          icon: IconScratch,
          available: () => true,
          ui: {
            kind: "action",
            run: () => {
              void starter.start()
            },
          },
        }),
      "scratchpad: /scratch command",
    )
  })
}
