import type { ResumeRecord, ResumeStore, ResumeTable } from "../contract"
import { RESUME_KEY } from "./domain"

/**
 * Build the resume store over the domain table.
 * @param table - the `requests` table of the `restart_resume` domain.
 * @returns the store that the coordinator and the resume flow share.
 */
export function createResumeStore(table: ResumeTable): ResumeStore {
  return {
    read: () => table.get(RESUME_KEY),
    save: (record: ResumeRecord) => table.put(RESUME_KEY, record),
    clear: () => table.delete(RESUME_KEY),
  }
}
