import type { InstallOutcome, PwaStore } from "../types"

/** The `beforeinstallprompt` event, sliced to what the plugin uses. */
export interface InstallPromptEvent {
  preventDefault(): void
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>
}

export interface InstallWindowLike {
  addEventListener(type: "beforeinstallprompt", listener: (event: InstallPromptEvent) => void): void
  addEventListener(type: "appinstalled", listener: () => void): void
  removeEventListener(
    type: "beforeinstallprompt",
    listener: (event: InstallPromptEvent) => void,
  ): void
  removeEventListener(type: "appinstalled", listener: () => void): void
}

export interface InstallPrompt {
  /** Run the browser's install dialog; "unavailable" when nothing was captured. */
  install(): Promise<InstallOutcome>
  /** Start capturing the install events; returns a disposer. */
  start(): () => void
}

/**
 * Capture the browser's install prompt so the Settings page can offer an
 * "Install app" button. The browser only fires the event once it considers
 * the app installable.
 */
export function createInstallPrompt(win: InstallWindowLike, store: PwaStore): InstallPrompt {
  let captured: InstallPromptEvent | undefined
  let listening = false

  const onPrompt = (event: InstallPromptEvent) => {
    event.preventDefault()
    captured = event
    store.update({ installable: true })
  }

  const onInstalled = () => {
    captured = undefined
    store.update({ installable: false })
  }

  const install = async (): Promise<InstallOutcome> => {
    const event = captured
    if (event === undefined) return "unavailable"
    captured = undefined
    store.update({ installable: false })
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome
  }

  return {
    install,
    start() {
      if (listening) return () => {}
      listening = true
      win.addEventListener("beforeinstallprompt", onPrompt)
      win.addEventListener("appinstalled", onInstalled)
      return () => {
        if (!listening) return
        listening = false
        win.removeEventListener("beforeinstallprompt", onPrompt)
        win.removeEventListener("appinstalled", onInstalled)
        captured = undefined
        store.update({ installable: false })
      }
    },
  }
}
