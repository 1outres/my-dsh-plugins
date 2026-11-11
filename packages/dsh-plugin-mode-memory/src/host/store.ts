import type { Clock, MemoryTable, ModeMemoryStore, PresetId, ProjectPath } from "../contract"

/**
 * Build the memory store over one domain table.
 * @param table - the open projects table.
 * @param now - clock in epoch milliseconds.
 * @returns the store the memory uses.
 */
export function createModeMemoryStore(table: MemoryTable, now: Clock): ModeMemoryStore {
  return {
    get: (project: ProjectPath) => table.get(project),
    remember: async (project: ProjectPath, agentPreset: PresetId) => {
      if (table.get(project)?.agentPreset === agentPreset) return
      await table.put(project, { agentPreset, updatedAt: now() })
    },
    forget: async (project: ProjectPath) => {
      await table.delete(project)
    },
  }
}
