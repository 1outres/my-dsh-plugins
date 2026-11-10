import z from "@deepseek-ai/schemastery"

/** A volatile field: the live value is read with `get()` at decision time. */
export interface VolatileValue<T> {
  get(): T
}

/** The Host config shape after the schema parses it (volatile fields are refs). */
export interface HostPushConfig {
  readonly enabled: VolatileValue<boolean>
  readonly onlyWhenUnfocused: VolatileValue<boolean>
  readonly approval: VolatileValue<boolean>
  readonly question: VolatileValue<boolean>
  readonly completion: VolatileValue<boolean>
  readonly showDetail: VolatileValue<boolean>
  readonly push: VolatileValue<boolean>
  /** VAPID `sub` claim used in Authorization headers. */
  readonly vapidSubject: string
}

/**
 * Settings schema. The switches are volatile so the Settings form can edit
 * them through the profile patch; the browser half reads the same projected
 * values through `configForms`, and the Host reads them at decision time.
 */
export const Config = z.object({
  enabled: z
    .boolean()
    .default(true)
    .description("Turn every notification off without uninstalling the plugin.")
    .volatile(),
  onlyWhenUnfocused: z
    .boolean()
    .default(true)
    .description("Skip notifications while this page is visible and focused.")
    .volatile(),
  approval: z
    .boolean()
    .default(true)
    .description("Notify when a tool call waits for approval.")
    .volatile(),
  question: z
    .boolean()
    .default(true)
    .description("Notify when the agent asks a question or proposes a plan to review.")
    .volatile(),
  completion: z.boolean().default(true).description("Notify when a turn stops running.").volatile(),
  showDetail: z
    .boolean()
    .default(true)
    .description("Add the tool name, the approval reason, or the question text to the body.")
    .volatile(),
  push: z
    .boolean()
    .default(true)
    .description(
      "Send Web Push notifications to devices that turned them on, so they arrive while the page is closed or in the background.",
    )
    .volatile(),
  vapidSubject: z
    .string()
    .default("https://github.com/1outres/my-dsh-plugins")
    .description(
      "VAPID subject: a mailto: or https: URL that push services may use to contact the sender.",
    ),
})
