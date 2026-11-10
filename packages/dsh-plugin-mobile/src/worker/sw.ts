import { clickMessage, openUrl, pickWindowClient, type WindowClientLike } from "./sw/click"
import { serveNavigation } from "./sw/navigation"
import { parseNotificationData } from "./sw/protocol"
import { buildNotification, readPushMessage } from "./sw/push"

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void
}

interface PushEventLike extends ExtendableEventLike {
  readonly data: { json(): unknown } | null
}

interface NotificationEventLike extends ExtendableEventLike {
  readonly notification: {
    readonly tag: string
    readonly data: unknown
    close(): void
  }
}

interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

interface WorkerScopeLike {
  readonly registration: {
    readonly scope: string
    showNotification(title: string, options?: NotificationOptions): Promise<void>
  }
  readonly clients: {
    matchAll(options: {
      type: "window"
      includeUncontrolled: boolean
    }): Promise<readonly WindowClientLike[]>
    openWindow(url: string): Promise<unknown>
    claim(): Promise<void>
  }
  readonly navigator: { readonly language: string }
  skipWaiting(): Promise<void>
  addEventListener(type: string, listener: (event: unknown) => void): void
}

const worker = self as unknown as WorkerScopeLike

async function handleClick(notification: NotificationEventLike["notification"]): Promise<void> {
  notification.close()
  const data = parseNotificationData(notification.data)
  const scope = worker.registration.scope
  const clients = await worker.clients.matchAll({ type: "window", includeUncontrolled: true })
  const client = pickWindowClient(clients, scope)
  if (client === null) {
    await worker.clients.openWindow(openUrl(data, scope))
    return
  }
  await client.focus()
  client.postMessage(clickMessage(data, notification.tag))
}

worker.addEventListener("install", (event) => {
  const install = event as ExtendableEventLike
  install.waitUntil(worker.skipWaiting())
})

worker.addEventListener("activate", (event) => {
  const activate = event as ExtendableEventLike
  activate.waitUntil(worker.clients.claim())
})

worker.addEventListener("push", (event) => {
  const push = event as PushEventLike
  const scope = worker.registration.scope
  const notification = buildNotification(readPushMessage(push.data), scope)
  push.waitUntil(worker.registration.showNotification(notification.title, notification.options))
})

worker.addEventListener("notificationclick", (event) => {
  const click = event as NotificationEventLike
  click.waitUntil(handleClick(click.notification))
})

worker.addEventListener("fetch", (event) => {
  const navigation = event as FetchEventLike
  if (navigation.request.mode !== "navigate") return
  navigation.respondWith(
    serveNavigation(navigation.request, (request) => fetch(request), worker.navigator.language),
  )
})
