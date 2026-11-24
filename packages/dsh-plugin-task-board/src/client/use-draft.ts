import { useEffect, useRef, useState } from "react"
import { resyncDraft } from "./drafts"

export function useDraft(saved: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(saved)
  const previous = useRef(saved)
  useEffect(() => {
    setDraft((current) => resyncDraft(current, previous.current, saved))
    previous.current = saved
  }, [saved])
  return [draft, setDraft]
}
