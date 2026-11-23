import { type ComponentType, createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { en, ja } from "../src/client/i18n"
import { apply, inject } from "../src/client/index"
import type {
  AdvisorFormValues,
  ClientContext,
  ConfigForm,
  ModelCatalog,
  RemoteResult,
  SlotRegistration,
} from "../src/client/types"
import { ADVISOR_DEFAULTS } from "../src/shared/settings"
import { CATALOG, fakeForm, flush } from "./client-support"

function harness(values: Partial<AdvisorFormValues> = {}) {
  const form = fakeForm<AdvisorFormValues>({ ...ADVISOR_DEFAULTS, ...values })
  const registrations: { spec: SlotRegistration; component: ComponentType }[] = []
  const served: string[][] = []
  const dictionaries: string[] = []
  const events = new Map<string, () => void>()
  const disposers: (() => void)[] = []
  let catalogCalls = 0
  const t = (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`
  const ctx = {
    effect(run: () => (() => void) | undefined) {
      const dispose = run()
      if (dispose !== undefined) disposers.push(dispose)
    },
    slots: {
      inject: (_key: string, register: () => () => void) => register(),
      register: (spec: SlotRegistration, component: ComponentType) => {
        registrations.push({ spec, component })
        return () => {}
      },
    },
    locale: {
      register: (namespace: string) => {
        dictionaries.push(namespace)
        return () => {}
      },
      bind: () => t,
    },
    configForms: {
      get: <T>() => form.form as unknown as ConfigForm<T>,
      whileServed: (namespaces: readonly string[], register: () => () => void) => {
        served.push([...namespaces])
        return register()
      },
    },
    remote: {
      session: {
        modelCatalog: async (): Promise<RemoteResult<ModelCatalog>> => {
          catalogCalls += 1
          return { ok: true, value: CATALOG }
        },
      },
      $on: (event: string, listener: () => void) => {
        events.set(event, listener)
        return () => events.delete(event)
      },
    },
  }
  return {
    ctx: ctx as unknown as ClientContext,
    form,
    registrations,
    served,
    dictionaries,
    events,
    catalogCalls: () => catalogCalls,
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

describe("advisor client half", () => {
  it("declares the services the page needs", () => {
    expect(inject).toEqual(["slots", "locale", "configForms", "remote", "remote.session"])
  })

  it("translates the same keys in en and ja", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
  })

  it("registers its dictionaries and a settings section while the advisor entry is served", () => {
    const h = harness()
    apply(h.ctx)
    expect(h.dictionaries).toEqual(["advisor"])
    expect(h.served).toEqual([["advisor"]])
    expect(h.registrations.map(({ spec }) => spec)).toMatchObject([
      { name: "settings.section", id: "advisor", locale: "advisor", order: 64 },
    ])
    h.dispose()
  })

  it("reloads the catalog when the Host model set changes", async () => {
    const h = harness()
    apply(h.ctx)
    expect([...h.events.keys()].sort()).toEqual(["llm/adapters-updated", "llm/models-updated"])
    h.events.get("llm/models-updated")?.()
    await flush()
    expect(h.catalogCalls()).toBe(1)
    h.dispose()
    expect(h.events.size).toBe(0)
  })

  it("renders the off state with every limit field", () => {
    const h = harness()
    apply(h.ctx)
    const component = h.registrations[0]?.component
    if (component === undefined) throw new Error("expected a page")
    const html = renderToStaticMarkup(createElement(component))
    expect(html).toContain("title")
    expect(html).toContain("statusOff")
    expect(html).toContain("modelOff")
    expect(html).toContain("adviceWordLimit")
    expect(html).toContain("timeoutMs")
    expect(html).not.toContain("reasoningEffort")
    h.dispose()
  })

  it("renders the selected route and its effort choices once the catalog is loaded", async () => {
    const h = harness({ provider: "claude", model: "opus" })
    apply(h.ctx)
    const component = h.registrations[0]?.component
    if (component === undefined) throw new Error("expected a page")
    h.events.get("llm/adapters-updated")?.()
    await flush()
    const html = renderToStaticMarkup(createElement(component))
    expect(html).toContain("statusOn:{&quot;model&quot;:&quot;claude/opus&quot;}")
    expect(html).toContain("Opus 5.5")
    expect(html).toContain("reasoningEffort")
    expect(html).toContain("effortDefault")
    h.dispose()
  })
})
