import { diffStatus, formatNotice, shouldNotify } from "../shared/notify"
import type { PwaNotificationData } from "../shared/protocol"
import { OPEN_SESSION_PARAM, PWA_CLICK_MESSAGE } from "../shared/protocol"
import type { NoticeSpec } from "../shared/types"
import { CONFIG_NAMESPACE, normalizeConfig } from "./config"
import { en } from "./i18n"
import { createBrowserPushEnvironment, createPushController, type HostPushRemote } from "./push"
import { type Notifier, SettingsPage } from "./SettingsPage"
import {
  createNotificationSink,
  type NotificationConstructorLike,
  type NotificationSink,
  type RegistrationLike,
  type SinkSpec,
} from "./sink"
import { NOTIFY_CSS } from "./styles"
import type { ClientContext, NotifyConfig, SessionStatusMap, Translate } from "./types"

/** Cordis services required by the browser half. */
export const inject = [
  "sessions",
  "uiSession",
  "uiWorkspace",
  "locale",
  "configForms",
  "slots",
  "remote",
]

const PLUGIN_ID = "@1outres/dsh-plugin-notify"
const TEST_TAG = `${PLUGIN_ID}:test`
const PUSH_NAMESPACE = "remote.notifyPush"

const jsonCodec = {
  mode: "strict" as const,
  typeSymbol: `${PLUGIN_ID}/json`,
  create: () => ({ parse: (value: unknown) => value }),
}

function parameter(name: string) {
  return { name, wire: name, source: "json" as const, codec: jsonCodec }
}

function descriptor(name: string, parameters: readonly ReturnType<typeof parameter>[] = []) {
  return {
    id: `${PLUGIN_ID}#${name}`,
    service: "notifyPush",
    namespace: "notifyPush",
    method: name,
    invocation: { kind: "direct" as const },
    parameters,
    result: jsonCodec,
  }
}

const contribution = {
  package: PLUGIN_ID,
  descriptors: [
    descriptor("publicKey"),
    descriptor("subscribe", [parameter("subscription")]),
    descriptor("unsubscribe", [parameter("endpoint")]),
    descriptor("presence", [parameter("endpoint"), parameter("visible"), parameter("focused")]),
    descriptor("status", [parameter("endpoint")]),
    descriptor("test", [parameter("endpoint")]),
  ],
}

/**
 * Browser half. It mirrors the Session status map into notifications and owns
 * the per-device Web Push subscription. When push is on, the Host is the only
 * source of notifications for this device and the page only closes resolved
 * ones.
 */
export async function apply(ctx: ClientContext): Promise<void> {
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

  await ctx.remote.$mount(contribution)
  const pushRemote = ctx.get(PUSH_NAMESPACE) as HostPushRemote | undefined
  if (pushRemote === undefined) {
    throw new Error("The notify push namespace is not mounted")
  }

  const form = ctx.configForms.get<NotifyConfig>(CONFIG_NAMESPACE)
  let config = normalizeConfig(form.getSnapshot().value)

  const pushController = createPushController({
    remote: pushRemote,
    environment: createBrowserPushEnvironment(),
  })

  ctx.effect(() => {
    let previousPush = config.push
    const read = () => {
      const next = normalizeConfig(form.getSnapshot().value)
      config = next
      if (next.push === previousPush) return
      previousPush = next.push
      void pushController.refresh()
    }
    const off = form.subscribe(read)
    read()
    return off
  }, "notify: configuration")

  ctx.effect(() => pushController.start(), "notify: push presence")

  const openSession = (sessionId: string) => {
    if (sessionId.length === 0) return
    ctx.uiWorkspace.openSession(sessionId)
  }

  const dataOf = (sessionId: string): PwaNotificationData => ({
    dshPwa: 1,
    openUrl:
      sessionId.length === 0 ? "./" : `./?${OPEN_SESSION_PARAM}=${encodeURIComponent(sessionId)}`,
    payload: { sessionId },
  })

  const clickData = (data: PwaNotificationData) => {
    const payload = data.payload
    if (isRecord(payload) && typeof payload.sessionId === "string") {
      openSession(payload.sessionId)
    }
    window.focus()
  }

  let windowSink: NotificationSink | undefined
  const sinkFor = async (): Promise<NotificationSink | undefined> => {
    const worker = serviceWorkerOf()
    if (worker !== undefined && worker.controller !== null) {
      const registration = await worker.ready
      return createNotificationSink({ kind: "registration", registration })
    }
    const Notification = windowNotification()
    if (Notification === undefined) return undefined
    windowSink ??= createNotificationSink({
      kind: "window",
      Notification,
      onClick: clickData,
    })
    return windowSink
  }

  const show = async (spec: NoticeSpec) => {
    const target = await sinkFor()
    if (target === undefined) return
    const data = dataOf(spec.sessionId)
    const sinkSpec: SinkSpec = {
      title: spec.title,
      body: spec.body,
      tag: spec.tag,
      data,
    }
    await target.show(sinkSpec)
  }

  const close = async (tag: string) => {
    const target = await sinkFor()
    if (target === undefined) return
    await target.close(tag)
  }

  const supported = (): boolean => typeof Notification !== "undefined"

  const permission = (): "granted" | "denied" | "default" | "unsupported" =>
    supported() ? Notification.permission : "unsupported"

  const request = async (): Promise<"granted" | "denied" | "default" | "unsupported"> => {
    if (!supported()) return "unsupported"
    if (Notification.permission !== "default") return Notification.permission
    try {
      return await Notification.requestPermission()
    } catch {
      return Notification.permission
    }
  }

  let autoRequested = false

  // A notification is the only way to tell the user about a background change,
  // so ask once per page load; Settings can always ask again with a gesture.
  const raise = async (spec: NoticeSpec) => {
    let state = permission()
    if (state === "default" && !autoRequested) {
      autoRequested = true
      state = await request()
    }
    if (state !== "granted") return
    await show(spec)
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
    for (const tag of diff.closed) void close(tag)
    if (pushController.state.getSnapshot() === "on") return
    if (!shouldNotify(config, pageState())) return
    for (const event of diff.opened) {
      void raise(formatNotice(event, titleOf(event.sessionId), { showDetail: config.showDetail }))
    }
  }

  ctx.effect(() => {
    const off = status.subscribe(sync)
    sync()
    return () => {
      off()
      void windowSink?.closeAll()
    }
  }, "notify: session status")

  ctx.effect(() => {
    const worker = serviceWorker()
    if (worker === undefined) return
    const listener = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; payload?: unknown } | null
      if (message === null || typeof message !== "object") return
      if (message.type !== PWA_CLICK_MESSAGE) return
      const payload = message.payload
      if (!isRecord(payload) || typeof payload.sessionId !== "string") return
      openSession(payload.sessionId)
      window.focus()
    }
    worker.addEventListener("message", listener)
    return () => worker.removeEventListener("message", listener)
  }, "notify: notification clicks")

  ctx.effect(() => {
    const url = new URL(window.location.href)
    const sessionId = url.searchParams.get(OPEN_SESSION_PARAM)
    if (sessionId === null || sessionId.length === 0) return
    url.searchParams.delete(OPEN_SESSION_PARAM)
    window.history.replaceState(window.history.state, "", url)
    openSession(sessionId)
  }, "notify: open session link")

  const notifier: Notifier = {
    permission,
    request,
    test: async () => {
      const state = await request()
      if (state !== "granted") return false
      await show({ tag: TEST_TAG, title: t("testTitle"), body: t("testBody"), sessionId: "" })
      return true
    },
  }

  const translate: Translate = t

  // biome-ignore lint/correctness/noComponentHookFactories: the page closes over the shared form, translator and push controller
  const Page = () => (
    <SettingsPage form={form} t={translate} notifier={notifier} push={pushController} />
  )

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

type ServiceWorkerLike = {
  readonly controller: unknown
  readonly ready: Promise<RegistrationLike>
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

function serviceWorker(): ServiceWorkerLike | undefined {
  const worker = (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker
  if (worker === undefined) return undefined
  return worker as unknown as ServiceWorkerLike
}

function serviceWorkerOf(): { controller: unknown; ready: Promise<RegistrationLike> } | undefined {
  const worker = serviceWorker()
  if (worker === undefined) return undefined
  return { controller: worker.controller, ready: worker.ready }
}

function windowNotification(): NotificationConstructorLike | undefined {
  if (typeof Notification === "undefined") return undefined
  return Notification as unknown as NotificationConstructorLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
