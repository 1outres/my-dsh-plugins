import type { PwaNotificationData } from "../shared/protocol"

/** What a sink needs to show one notification. */
export interface SinkSpec {
  readonly title: string
  readonly body: string
  readonly tag: string
  readonly data: PwaNotificationData
  readonly renotify?: boolean
}

/** A way to show and close notifications on this page. */
export interface NotificationSink {
  show(spec: SinkSpec): Promise<void>
  close(tag: string): Promise<void>
  closeAll(): Promise<void>
}

export interface NotificationLike {
  onclick: (() => void) | null
  onclose: (() => void) | null
  close(): void
}

export interface NotificationConstructorLike {
  new (
    title: string,
    options: {
      readonly body: string
      readonly tag: string
      readonly data: PwaNotificationData
      readonly renotify?: boolean
    },
  ): NotificationLike
}

/** The slice of `ServiceWorkerRegistration` the sink uses. */
export interface RegistrationLike {
  showNotification(title: string, options: Record<string, unknown>): Promise<void>
  getNotifications(options?: { readonly tag?: string }): Promise<readonly { close(): void }[]>
}

/**
 * How the page shows a notification. The choice is made from capabilities at
 * the time of use: a page controlled by the worker shows through the
 * registration, otherwise the page Notification API is the only option.
 */
export type SinkSelection =
  | { readonly kind: "registration"; readonly registration: RegistrationLike }
  | {
      readonly kind: "window"
      readonly Notification: NotificationConstructorLike
      readonly onClick: (data: PwaNotificationData) => void
    }
  | { readonly kind: "none" }

/** Build the sink for one explicit capability choice. */
export function createNotificationSink(selection: SinkSelection): NotificationSink | undefined {
  switch (selection.kind) {
    case "registration":
      return new RegistrationSink(selection.registration)
    case "window":
      return new WindowSink(selection.Notification, selection.onClick)
    case "none":
      return undefined
  }
}

class RegistrationSink implements NotificationSink {
  readonly #registration: RegistrationLike

  constructor(registration: RegistrationLike) {
    this.#registration = registration
  }

  async show(spec: SinkSpec): Promise<void> {
    await this.#registration.showNotification(spec.title, {
      body: spec.body,
      tag: spec.tag,
      data: spec.data,
      renotify: spec.renotify,
    })
  }

  async close(tag: string): Promise<void> {
    const notifications = await this.#registration.getNotifications({ tag })
    for (const notification of notifications) notification.close()
  }

  async closeAll(): Promise<void> {
    const notifications = await this.#registration.getNotifications()
    for (const notification of notifications) notification.close()
  }
}

class WindowSink implements NotificationSink {
  readonly #Notification: NotificationConstructorLike
  readonly #onClick: (data: PwaNotificationData) => void
  readonly #live = new Map<string, NotificationLike>()

  constructor(
    Notification: NotificationConstructorLike,
    onClick: (data: PwaNotificationData) => void,
  ) {
    this.#Notification = Notification
    this.#onClick = onClick
  }

  async show(spec: SinkSpec): Promise<void> {
    await this.close(spec.tag)
    const notification = new this.#Notification(spec.title, {
      body: spec.body,
      tag: spec.tag,
      data: spec.data,
      renotify: spec.renotify,
    })
    this.#live.set(spec.tag, notification)
    notification.onclick = () => {
      this.#onClick(spec.data)
      void this.close(spec.tag)
    }
    notification.onclose = () => {
      if (this.#live.get(spec.tag) === notification) this.#live.delete(spec.tag)
    }
  }

  async close(tag: string): Promise<void> {
    const notification = this.#live.get(tag)
    if (notification === undefined) return
    this.#live.delete(tag)
    notification.close()
  }

  async closeAll(): Promise<void> {
    for (const tag of [...this.#live.keys()]) await this.close(tag)
  }
}

export interface SinkEnvironment {
  readonly serviceWorker?: {
    readonly controller: unknown
    readonly ready: Promise<RegistrationLike>
  }
  readonly Notification?: NotificationConstructorLike
  readonly onClick: (data: PwaNotificationData) => void
}

/** Choose the sink explicitly from what this browser can do right now. */
export async function selectNotificationSink(
  environment: SinkEnvironment,
): Promise<NotificationSink | undefined> {
  const worker = environment.serviceWorker
  if (worker !== undefined && worker.controller !== null) {
    const registration = await worker.ready
    return createNotificationSink({ kind: "registration", registration })
  }
  if (environment.Notification !== undefined) {
    return createNotificationSink({
      kind: "window",
      Notification: environment.Notification,
      onClick: environment.onClick,
    })
  }
  return createNotificationSink({ kind: "none" })
}
