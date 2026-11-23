import { createElement } from "react"
import { ADVISOR_NAMESPACE } from "../shared/settings"
import { AdvisorSettingsController } from "./controller"
import { en, ja } from "./i18n"
import { SettingsPage } from "./SettingsPage"
import type { AdvisorFormValues, ClientContext, HostModelEvent } from "./types"

export const inject = ["slots", "locale", "configForms", "remote", "remote.session"]

const SECTION_ORDER = 64

const MODEL_EVENTS: readonly HostModelEvent[] = ["llm/adapters-updated", "llm/models-updated"]

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(ADVISOR_NAMESPACE)

  ctx.effect(() => ctx.locale.register(ADVISOR_NAMESPACE, { en, ja }), "advisor: dictionaries")

  const controller = new AdvisorSettingsController({
    form: ctx.configForms.get<AdvisorFormValues>(ADVISOR_NAMESPACE),
    loadCatalog: () => ctx.remote.session.modelCatalog(),
  })
  ctx.effect(() => () => controller.dispose(), "advisor: settings state")

  for (const event of MODEL_EVENTS) {
    ctx.effect(() => ctx.remote.$on(event, () => controller.refreshCatalog()), `advisor: ${event}`)
  }

  const renderSettingsPage = () => createElement(SettingsPage, { controller, t })

  ctx.effect(
    () =>
      ctx.configForms.whileServed([ADVISOR_NAMESPACE], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: ADVISOR_NAMESPACE,
              order: SECTION_ORDER,
              label: () => t("nav"),
              locale: ADVISOR_NAMESPACE,
            },
            renderSettingsPage,
          ),
        ),
      ),
    "advisor: settings section",
  )
}
