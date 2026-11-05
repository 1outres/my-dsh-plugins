import { CONFIG_NAMESPACE, normalizeConfig } from "./config"
import { en } from "./i18n"
import { diffStatus, formatNotice, type NoticeSpec, shouldNotify } from "./notify"
import { type Notifier, SettingsPage } from "./SettingsPage"
import { NOTIFY_CSS } from "./styles"
import type { ClientContext, NotifyConfig, SessionStatusMap, Translate } from "./types"

/** Cordis services required by the browser half. */
export const inject = ["sessions", "uiSession", "uiWorkspace", "locale", "configForms", "slots"]

const PLUGIN_ID = "@1outres/dsh-plugin-notify"
const TEST_TAG = `${PLUGIN_ID}:test`

/**
 * Browser half. The Host cannot know whether the page is visible, so the
 * browser that owns the Session raises the notification itself: it watches the
 * Session status map and mirrors new pending interactions and finished turns
 * into Web Notifications.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(CONFIG_NAMESPACE)

  ctx.effect(() => ctx.locale.register(CONFIG_NAMESPACE, { en }), "notify: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/notify.css`
    tag.textContent = NOTIFY_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "notify: stylesheet")

  const form = ctx.configForms.get<NotifyConfig>(CONFIG_NAMESPACE)
  let config = normalizeConfig(form.getSnapshot().value)

  ctx.effect(() => {
    const read = () => {
      config = normalizeConfig(form.getSnapshot().value)
    }
    const off = form.subscribe(read)
    read()
    return off
  }, "notify: configuration")

  const live = new Map<string, Notification>()
  let autoRequested = false

  const supported = (): boolean => typeof Notification !== "undefined"

  const permission = (): "granted" | "denied" | "default" | "unsupported" =>
    supported() ? Notification.permission : "unsupported"

  const close = (tag: string) => {
    const notification = live.get(tag)
    if (notification === undefined) return
    live.delete(tag)
    try {
      notification.close()
    } catch {
      // The browser may have reaped it already.
    }
  }

  const closeAll = () => {
    for (const tag of [...live.keys()]) close(tag)
  }

  const request = async (): Promise<"granted" | "denied" | "default" | "unsupported"> => {
    if (!supported()) return "unsupported"
    if (Notification.permission !== "default") return Notification.permission
    try {
      return await Notification.requestPermission()
    } catch {
      return Notification.permission
    }
  }

  const show = (spec: NoticeSpec) => {
    if (!supported()) return
    close(spec.tag)
    const notification = new Notification(spec.title, { body: spec.body, tag: spec.tag })
    live.set(spec.tag, notification)
    notification.onclick = () => {
      try {
        if (spec.sessionId.length > 0) ctx.uiWorkspace.openSession(spec.sessionId)
      } catch {
        // Navigation is best effort; the click still focuses the window.
      }
      try {
        window.focus()
      } catch {
        // Focus may be refused outside a browser.
      }
      close(spec.tag)
    }
    notification.onclose = () => {
      if (live.get(spec.tag) === notification) live.delete(spec.tag)
    }
  }

  // Ask the browser once per page load when a notification is the only way to
  // tell the user; the Settings page can always request with a real gesture.
  const push = async (spec: NoticeSpec) => {
    if (!supported()) return
    let state = permission()
    if (state === "default" && !autoRequested) {
      autoRequested = true
      state = await request()
    }
    if (state !== "granted") return
    show(spec)
  }

  const pageState = () => ({
    visible: typeof document === "undefined" ? true : document.visibilityState !== "hidden",
    focused: typeof document === "undefined" ? true : document.hasFocus(),
  })

  const rowOf = (sessionId: string) => ctx.sessions.list.getSnapshot().byId[sessionId]

  const isListed = (sessionId: string) => {
    const row = rowOf(sessionId)
    return row !== undefined && row.origin !== "subagent"
  }

  const titleOf = (sessionId: string) => {
    const row = rowOf(sessionId)
    return row?.title ?? row?.displayTitle ?? ""
  }

  const status = ctx.uiSession.sessionStatus
  let previous: SessionStatusMap | undefined

  const sync = () => {
    const next = status.getSnapshot()
    const diff = diffStatus(previous, next, {
      approval: config.approval,
      question: config.question,
      completion: config.completion,
      notifySession: isListed,
    })
    previous = next
    for (const tag of diff.closed) close(tag)
    if (!shouldNotify(config, pageState())) return
    for (const event of diff.opened) {
      void push(formatNotice(event, titleOf(event.sessionId), { showDetail: config.showDetail }))
    }
  }

  ctx.effect(() => {
    const off = status.subscribe(sync)
    sync()
    return () => {
      off()
      closeAll()
    }
  }, "notify: session status")

  const notifier: Notifier = {
    permission,
    request,
    test: async () => {
      const state = await request()
      if (state !== "granted") return false
      show({ tag: TEST_TAG, title: t("testTitle"), body: t("testBody"), sessionId: "" })
      return true
    },
  }

  const translate: Translate = t

  // biome-ignore lint/correctness/noComponentHookFactories: the page closes over the shared form, translator and notifier
  const Page = () => <SettingsPage form={form} t={translate} notifier={notifier} />

  ctx.effect(
    () =>
      ctx.configForms.whileServed([CONFIG_NAMESPACE], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: "notify",
              order: 61,
              label: () => t("nav"),
              locale: CONFIG_NAMESPACE,
            },
            Page,
          ),
        ),
      ),
    "notify: settings section",
  )
}
