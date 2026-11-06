import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEffortStore } from "../src/client/efforts"
import { createFavoritesStore } from "../src/client/favorites"
import { ModelPicker, type PickerProps } from "../src/client/Picker"
import { createRecentStore } from "../src/client/recent"
import type { ConfigForm, ModelDirectoryState, ModelPickerConfig } from "../src/client/types"

const state: ModelDirectoryState = {
  current: { provider: "orcarouter", model: "anthropic/claude-opus-4.6", reasoningEffort: "xhigh" },
  routable: true,
  groups: [
    {
      id: "orcarouter",
      name: "OrcaRouter",
      models: [
        {
          id: "anthropic/claude-opus-4.6",
          name: "Anthropic: Claude Opus 4.6",
          reasoning: {
            efforts: [
              { id: "high", name: "High" },
              { id: "xhigh", name: "Extra high" },
            ],
          },
        },
      ],
    },
  ],
  failures: [],
  status: "ready",
  pending: null,
  error: null,
}

const form: ConfigForm<ModelPickerConfig> = {
  getSnapshot: () => ({ status: "ready", value: { favorites: [] }, revision: 1, writable: true }),
  subscribe: () => () => {},
  set: async () => true,
  unset: async () => true,
}

function render(overrides: Partial<PickerProps> = {}): string {
  const props: PickerProps = {
    locked: false,
    available: true,
    directory: { getSnapshot: () => state, subscribe: () => () => {} },
    load: () => {},
    select: async () => ({ ok: true, value: undefined }),
    favorites: createFavoritesStore(form),
    recent: createRecentStore(undefined),
    efforts: createEffortStore(undefined),
    t: (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`),
    ...overrides,
  }
  return renderToStaticMarkup(createElement(ModelPicker, props))
}

beforeEach(() => {
  // React warns that layout effects do not run on the server.
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("model picker trigger", () => {
  it("shows the current model and its effort", () => {
    const html = render()
    expect(html).toContain('data-provider-id="orcarouter"')
    expect(html).toContain('data-model-id="anthropic/claude-opus-4.6"')
    expect(html).toContain("Anthropic: Claude Opus 4.6")
    expect(html).toContain('class="dsh-mp-trigger-effort">Extra high<')
    expect(html).toContain('aria-expanded="false"')
  })

  it("is disabled while the composer is locked", () => {
    expect(render({ locked: true })).toMatch(/<button[^>]*disabled=""/u)
  })

  it("renders nothing for an addressed subagent Session", () => {
    expect(render({ available: false })).toBe("")
  })
})
