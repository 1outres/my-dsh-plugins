import { WORKER_SCOPE, WORKER_SCRIPT_PATH, WORKER_SCRIPT_URL } from "../../worker/protocol"
import type { MediaQueryLike } from "../page"
import type { BooleanSetting, PwaStore } from "../types"
import { detectPlatform } from "./state"

/** Media query that is true inside an installed app window. */
export const STANDALONE_QUERY = "(display-mode: standalone)"

/** The slice of `ServiceWorkerRegistration` the plugin reads. */
export interface WorkerRegistrationLike {
  readonly active?: { readonly scriptURL: string } | null
  unregister(): Promise<boolean>
}

/** The slice of `ServiceWorkerContainer` the plugin uses. */
export interface ServiceWorkerContainerLike {
  register(url: string, options: { scope: string }): Promise<WorkerRegistrationLike>
  getRegistration(clientURL: string): Promise<WorkerRegistrationLike | undefined>
}

export interface WorkerNavigatorLike {
  readonly serviceWorker?: ServiceWorkerContainerLike
  readonly standalone?: boolean
  readonly userAgent: string
  readonly platform?: string
  readonly maxTouchPoints?: number
}

/** The slice of `window` the PWA worker registration uses. */
export interface WorkerWindowLike {
  readonly isSecureContext: boolean
  readonly navigator: WorkerNavigatorLike
  matchMedia(query: string): MediaQueryLike
}

/**
 * Register the app's service worker while the setting is on, and unregister it
 * when the setting turns off. Teardown keeps the registration: an HMR reload
 * tears the plugin down and would otherwise drop push subscriptions.
 * @returns a disposer removing the listeners; it leaves the registration in place.
 */
export function installPwaWorker(
  win: WorkerWindowLike,
  store: PwaStore,
  setting: BooleanSetting,
): () => void {
  const container = win.navigator.serviceWorker
  const display = win.matchMedia(STANDALONE_QUERY)
  const standalone = () => display.matches || win.navigator.standalone === true

  store.update({
    platform: detectPlatform(
      win.navigator.userAgent,
      win.navigator.platform ?? "",
      win.navigator.maxTouchPoints ?? 0,
    ),
    standalone: standalone(),
  })

  const onDisplayMode = () => store.update({ standalone: standalone() })
  display.addEventListener("change", onDisplayMode)

  let disposed = false
  let enabled = setting.get()
  let started = false
  let pending: Promise<void> | undefined

  const unregisterOwn = async (): Promise<void> => {
    if (container === undefined) return
    const registration = await container.getRegistration(WORKER_SCOPE)
    if (registration?.active?.scriptURL.endsWith(WORKER_SCRIPT_PATH) === true) {
      await registration.unregister()
    }
  }

  const deactivate = (unregister: boolean) => {
    if (!started) return
    started = false
    if (!unregister || container === undefined) return
    const after = pending ?? Promise.resolve()
    void after
      .then(unregisterOwn, unregisterOwn)
      .catch((error) => console.warn("mobile: could not unregister the service worker", error))
  }

  const activate = () => {
    if (container === undefined) {
      store.update({ worker: "unsupported" })
      return
    }
    if (!win.isSecureContext) {
      store.update({ worker: "insecure" })
      return
    }
    started = true
    store.update({ worker: "registering" })
    pending = container.register(WORKER_SCRIPT_URL, { scope: WORKER_SCOPE }).then(
      () => {
        if (!disposed && started) store.update({ worker: "ready" })
      },
      (error) => {
        started = false
        console.warn("mobile: could not register the service worker", error)
        store.update({ worker: "failed" })
      },
    )
  }

  const apply = () => {
    if (enabled) {
      activate()
      return
    }
    deactivate(true)
    store.update({ worker: "off" })
  }

  const off = setting.subscribe(() => {
    const next = setting.get()
    if (next === enabled) return
    enabled = next
    apply()
  })

  apply()

  return () => {
    disposed = true
    off()
    display.removeEventListener("change", onDisplayMode)
    deactivate(false)
  }
}
