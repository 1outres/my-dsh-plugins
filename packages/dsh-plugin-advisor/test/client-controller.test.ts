import { describe, expect, it } from "vitest"
import { routeKey } from "../src/client/catalog"
import { AdvisorSettingsController } from "../src/client/controller"
import type { AdvisorFormValues } from "../src/client/types"
import { ADVISOR_DEFAULTS } from "../src/shared/settings"
import { catalogLoader, fakeForm, flush } from "./client-support"

function setup(values: Partial<AdvisorFormValues> = {}, writable = true) {
  const form = fakeForm<AdvisorFormValues>({ ...ADVISOR_DEFAULTS, ...values }, writable)
  const catalog = catalogLoader()
  const controller = new AdvisorSettingsController({ form: form.form, loadCatalog: catalog.load })
  return { form, catalog, controller }
}

describe("AdvisorSettingsController", () => {
  it("starts off with the stored values and no catalog request", () => {
    const { controller, catalog } = setup()
    const snapshot = controller.getSnapshot()
    expect(snapshot.status).toBe("ready")
    expect(snapshot.values).toEqual(ADVISOR_DEFAULTS)
    expect(snapshot.selectedKey).toBe("")
    expect(snapshot.catalog.status).toBe("idle")
    expect(catalog.calls()).toBe(0)
  })

  it("loads the model catalog once when the page asks for it", async () => {
    const { controller, catalog } = setup()
    controller.ensureCatalog()
    controller.ensureCatalog()
    await flush()
    expect(catalog.calls()).toBe(1)
    const snapshot = controller.getSnapshot()
    expect(snapshot.catalog).toEqual({ status: "ready", partial: false })
    expect(snapshot.routeGroups.map((group) => group.id)).toEqual(["deepseek", "claude"])
  })

  it("reports a failed catalog request and loads again on refresh", async () => {
    const form = fakeForm<AdvisorFormValues>({ ...ADVISOR_DEFAULTS })
    let calls = 0
    const controller = new AdvisorSettingsController({
      form: form.form,
      loadCatalog: async () => {
        calls += 1
        return { ok: false, error: { code: "x", message: "offline" } }
      },
    })
    controller.ensureCatalog()
    await flush()
    expect(controller.getSnapshot().catalog).toEqual({
      status: "error",
      partial: false,
      error: "offline",
    })
    controller.refreshCatalog()
    await flush()
    expect(calls).toBe(2)
  })

  it("writes provider and model together and clears the old effort", async () => {
    const { controller, form } = setup({ reasoningEffort: "low" })
    controller.ensureCatalog()
    await flush()

    await controller.selectRoute(routeKey("claude", "opus"))

    expect(form.mutations).toEqual([
      [
        { op: "set", path: ["provider"], value: "claude" },
        { op: "set", path: ["model"], value: "opus" },
        { op: "unset", path: ["reasoningEffort"] },
      ],
    ])
    const snapshot = controller.getSnapshot()
    expect(snapshot.selectedKey).toBe(routeKey("claude", "opus"))
    expect(snapshot.efforts.map((effort) => effort.id)).toEqual(["high"])
  })

  it("turns the advisor off by clearing the whole route", async () => {
    const { controller, form } = setup({ provider: "claude", model: "opus" })
    await controller.selectRoute("")
    expect(form.mutations).toEqual([
      [
        { op: "unset", path: ["provider"] },
        { op: "unset", path: ["model"] },
        { op: "unset", path: ["reasoningEffort"] },
      ],
    ])
    expect(controller.getSnapshot().selectedKey).toBe("")
  })

  it("ignores a key that names no listed route", async () => {
    const { controller, form } = setup()
    await expect(controller.selectRoute(routeKey("x", "y"))).resolves.toBe(false)
    expect(form.mutations).toEqual([])
  })

  it("sets or clears the reasoning effort", async () => {
    const { controller, form } = setup({ provider: "claude", model: "opus" })
    await controller.selectEffort("high")
    await controller.selectEffort("")
    expect(form.mutations).toEqual([
      [{ op: "set", path: ["reasoningEffort"], value: "high" }],
      [{ op: "unset", path: ["reasoningEffort"] }],
    ])
  })

  it("writes a valid limit and reports an invalid one inline", async () => {
    const { controller, form } = setup()
    await controller.commitLimit("adviceWordLimit", "80")
    await controller.commitLimit("timeoutMs", "10")
    expect(form.mutations).toEqual([[{ op: "set", path: ["adviceWordLimit"], value: 80 }]])
    expect(controller.getSnapshot().errors).toEqual({ timeoutMs: "invalidTimeoutMs" })

    await controller.commitLimit("timeoutMs", "60000")
    expect(controller.getSnapshot().errors).toEqual({})
  })

  it("flags a write the Host refuses", async () => {
    const { controller, form } = setup()
    form.refuseWrites()
    await controller.commitLimit("adviceWordLimit", "80")
    expect(controller.getSnapshot().writeError).toBe(true)
  })

  it("does not write when the Host document is read-only", async () => {
    const { controller, form } = setup({}, false)
    await controller.commitLimit("adviceWordLimit", "80")
    await controller.selectEffort("high")
    expect(form.mutations).toEqual([])
    expect(controller.getSnapshot().writable).toBe(false)
  })

  it("follows Host changes and notifies subscribers", () => {
    const { controller, form } = setup()
    let notified = 0
    const off = controller.subscribe(() => {
      notified += 1
    })
    form.setValue({ provider: "deepseek", model: "v4" })
    expect(notified).toBe(1)
    expect(controller.getSnapshot().selectedKey).toBe(routeKey("deepseek", "v4"))
    off()
    controller.dispose()
  })
})
