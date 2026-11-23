import type { ModelProviderGroup, ModelReasoningEffort } from "./types"

export interface RouteRef {
  readonly provider: string
  readonly model: string
}

export interface RouteChoice extends RouteRef {
  readonly key: string
  readonly name: string
  readonly available: boolean
}

export interface RouteGroup {
  readonly id: string
  readonly name: string
  readonly routes: readonly RouteChoice[]
}

export function routeKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

export function routeGroups(groups: readonly ModelProviderGroup[], saved: RouteRef): RouteGroup[] {
  const listed: RouteGroup[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    routes: group.models.map((model) => ({
      key: routeKey(group.id, model.id),
      provider: group.id,
      model: model.id,
      name: model.name,
      available: true,
    })),
  }))
  if (saved.provider === "" || saved.model === "") return listed
  const savedKey = routeKey(saved.provider, saved.model)
  if (listed.some((group) => group.routes.some((route) => route.key === savedKey))) return listed
  return [
    ...listed,
    {
      id: saved.provider,
      name: saved.provider,
      routes: [
        {
          key: savedKey,
          provider: saved.provider,
          model: saved.model,
          name: saved.model,
          available: false,
        },
      ],
    },
  ]
}

export function findRoute(groups: readonly RouteGroup[], key: string): RouteRef | undefined {
  for (const group of groups) {
    const route = group.routes.find((candidate) => candidate.key === key)
    if (route !== undefined) return { provider: route.provider, model: route.model }
  }
  return undefined
}

export function effortChoices(
  groups: readonly ModelProviderGroup[],
  provider: string,
  model: string,
): readonly ModelReasoningEffort[] {
  const entry = groups
    .find((group) => group.id === provider)
    ?.models.find((candidate) => candidate.id === model)
  return entry?.reasoning?.efforts ?? []
}
