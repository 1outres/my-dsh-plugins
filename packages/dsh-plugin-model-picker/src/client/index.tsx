import { CONFIG_NAMESPACE } from "./config"
import { createFavoritesStore } from "./favorites"
import { en } from "./i18n"
import { ModelPicker } from "./Picker"
import { createRecentStore, type StorageEventTarget, type StorageLike } from "./recent"
import { PICKER_CSS } from "./styles"
import type { ClientContext, ModelPickerConfig, ModelSelection } from "./types"

/**
 * Cordis services required by the browser half. Without `modelDirectories`
 * the shipped seat stays. `directoryFor()` runs against the caller's context
 * and creates a Session's directory over `remote.session`, so the caller must
 * inject the remote faces the shipped service declares.
 */
export const inject = [
  "slots",
  "locale",
  "configForms",
  "sessions",
  "remote",
  "remote.session",
  "modelDirectories",
]

const PLUGIN_ID = "@1outres/dsh-plugin-model-picker"

/** The composer seat this plugin shadows. */
export const SEAT = "conversation.input.model"

/**
 * The shipped selector sits at priority 0 and the lowest number renders.
 * Pages allocate -1, -2, ... to dynamic packages, so stay clear of them.
 */
export const SEAT_PRIORITY = -100

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    // Storage access can throw under strict privacy settings.
    return undefined
  }
}

function storageEvents(): StorageEventTarget | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as StorageEventTarget)
}

/**
 * Browser half: shadow the composer model seat with a searchable picker over
 * the Session's shared model directory. Favorites live in the plugin's
 * settings entry, recent models in this browser.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(CONFIG_NAMESPACE, { en }), "model-picker: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/picker.css`
    tag.textContent = PICKER_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "model-picker: stylesheet")

  const favorites = createFavoritesStore(ctx.configForms.get<ModelPickerConfig>(CONFIG_NAMESPACE))
  const recent = createRecentStore(browserStorage(), storageEvents())
  ctx.effect(() => favorites.connect(), "model-picker: favorites")
  ctx.effect(() => recent.connect(), "model-picker: recent models")

  ctx.effect(
    () =>
      ctx.slots.inject(SEAT, () =>
        ctx.slots.register(
          {
            name: SEAT,
            priority: SEAT_PRIORITY,
            locale: CONFIG_NAMESPACE,
            inject: (sessionId: string) => {
              const directory = ctx.modelDirectories.directoryFor(sessionId)
              const available = ctx.sessions.subagentAddress(sessionId) === undefined
              return {
                available,
                directory: directory.store,
                load: () => {
                  if (available) directory.load().catch(() => {})
                },
                select: (selection: ModelSelection) =>
                  available ? directory.select(selection) : Promise.resolve(undefined),
                favorites,
                recent,
              }
            },
          },
          ModelPicker,
        ),
      ),
    "model-picker: composer seat",
  )
}
