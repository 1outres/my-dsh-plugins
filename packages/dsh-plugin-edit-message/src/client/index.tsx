import { createEditableUserMessage } from "./EditableUserMessage"
import { runEdit } from "./edit"
import { en } from "./i18n"
import { EDIT_CSS } from "./styles"
import type { ClientContext } from "./types"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "sessions", "uiWorkspace", "workspaces"]

const PLUGIN_ID = "@1outres/dsh-plugin-edit-message"

/** Locale namespace for this plugin's own copy. */
export const NAMESPACE = "edit-message"

/** The keyed Chat node slot and the key whose renderer this plugin wraps. */
export const NODE_SLOT = "conversation.chat.node"
export const NODE_KEY = "user"

/**
 * The shipped renderer sits at priority 0 and the lowest number renders.
 * Pages allocate -1, -2, ... to dynamic packages, so stay clear of them.
 */
export const NODE_PRIORITY = -100

/** The wrapped renderer reads Chat copy, so the entry keeps Chat's locale. */
const CHAT_NAMESPACE = "chat"

/**
 * Browser half: wrap the shipped user-message renderer so each prompt that
 * opens a turn gets an Edit button beside Copy. Sending an edit forks the
 * Session before that turn, sends the edited text there, opens the fork, and
 * archives the original.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en }), "edit-message: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/edit.css`
    tag.textContent = EDIT_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "edit-message: stylesheet")

  const slots = ctx.slots
  if (typeof slots.entries !== "function") {
    console.warn("edit-message: this Harness exposes no slot entries; the plugin stays inactive")
    return
  }
  const entries = () => slots.entries?.(NODE_SLOT) ?? []

  const View = createEditableUserMessage({
    entries,
    priority: NODE_PRIORITY,
    t: ctx.locale.bind(NAMESPACE),
    edit: (request) =>
      runEdit(
        {
          sessions: ctx.sessions,
          uiWorkspace: ctx.uiWorkspace,
          workspaces: ctx.workspaces,
          warn: (message, error) => console.warn(message, error),
        },
        request,
      ),
  })

  ctx.effect(
    () =>
      slots.inject(NODE_SLOT, () =>
        slots.register(
          { name: NODE_SLOT, key: NODE_KEY, priority: NODE_PRIORITY, locale: CHAT_NAMESPACE },
          View,
        ),
      ),
    "edit-message: user message renderer",
  )
}
