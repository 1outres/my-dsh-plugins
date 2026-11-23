import type {
  ConfigForm,
  ConfigFormSnapshot,
  ModelCatalog,
  RemoteResult,
  SettingsPathOp,
} from "../src/client/types"

export interface FakeForm<T> {
  readonly form: ConfigForm<T>
  readonly mutations: (readonly SettingsPathOp[])[]
  setValue(value: Partial<T>): void
  refuseWrites(): void
}

export function fakeForm<T extends object>(initial: T, writable = true): FakeForm<T> {
  let value: Record<string, unknown> = { ...(initial as Record<string, unknown>) }
  let revision = 1
  let accept = true
  const mutations: (readonly SettingsPathOp[])[] = []
  const listeners = new Set<() => void>()
  let snapshot: ConfigFormSnapshot<T> = { status: "ready", value: value as T, revision, writable }
  const notify = () => {
    revision += 1
    snapshot = { status: "ready", value: value as T, revision, writable }
    for (const listener of [...listeners]) listener()
  }
  return {
    mutations,
    form: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      mutate: async (ops) => {
        mutations.push(ops)
        if (!accept) return false
        const next = { ...value }
        for (const op of ops) {
          const [field] = op.path
          if (field === undefined) continue
          if (op.op === "set") next[field] = op.value
          else delete next[field]
        }
        value = next
        notify()
        return true
      },
    },
    setValue: (next) => {
      value = { ...value, ...next }
      notify()
    },
    refuseWrites: () => {
      accept = false
    },
  }
}

export const CATALOG: ModelCatalog = {
  groups: [
    { id: "deepseek", name: "DeepSeek", models: [{ id: "v4", name: "DeepSeek V4" }] },
    {
      id: "claude",
      name: "Claude subscription",
      models: [
        {
          id: "opus",
          name: "Opus 5.5",
          reasoning: { efforts: [{ id: "high", name: "High" }], defaultEffort: "high" },
        },
      ],
    },
  ],
  failures: [],
}

export function catalogLoader(result: RemoteResult<ModelCatalog> = { ok: true, value: CATALOG }) {
  let calls = 0
  return {
    load: async () => {
      calls += 1
      return result
    },
    calls: () => calls,
  }
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}
