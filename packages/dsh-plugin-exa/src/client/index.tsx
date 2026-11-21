import { CONFIG_NAMESPACE, WEB_NAMESPACE } from "./config"
import { ExaSettingsController } from "./controller"
import { en, ja, zh } from "./i18n"
import { SettingsPage } from "./SettingsPage"
import type { ClientContext, ExaConfig, WebConfig } from "./types"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "configForms", "remote", "remote.credentials"]

/** Browser half: the Exa settings page and its credential state. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(CONFIG_NAMESPACE)

  ctx.effect(() => ctx.locale.register(CONFIG_NAMESPACE, { en, ja, zh }), "exa: dictionaries")

  const controller = new ExaSettingsController({
    form: ctx.configForms.get<ExaConfig>(CONFIG_NAMESPACE),
    webForm: ctx.configForms.get<WebConfig>(WEB_NAMESPACE),
    credentials: ctx.remote.credentials,
  })

  ctx.effect(() => () => controller.dispose(), "exa: settings state")

  ctx.effect(
    () =>
      ctx.remote.$on("credentials/reference-updated", (ref) => controller.refreshCredential(ref)),
    "exa: credential updates",
  )

  // biome-ignore lint/correctness/noComponentHookFactories: the page closes over the shared controller and translator
  const Page = () => <SettingsPage controller={controller} t={t} />

  ctx.effect(
    () =>
      ctx.configForms.whileServed([CONFIG_NAMESPACE], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: CONFIG_NAMESPACE,
              order: 63,
              label: () => t("nav"),
              locale: CONFIG_NAMESPACE,
            },
            Page,
          ),
        ),
      ),
    "exa: settings section",
  )
}
