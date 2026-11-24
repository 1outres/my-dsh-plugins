import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react"
import type { SnapshotStore } from "./state/store"

export function useSnapshot<T>(store: SnapshotStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  const latest = useRef(onDismiss)
  latest.current = onDismiss
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent): void => {
      const root = ref.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      latest.current()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [active, ref])
}

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>): void {
  useEffect(() => {
    const node = ref.current
    if (node === null) return
    node.style.height = "auto"
    node.style.height = `${String(node.scrollHeight + node.offsetHeight - node.clientHeight)}px`
  })
}
