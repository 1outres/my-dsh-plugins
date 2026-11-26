export function nextFocusIndex(current: number, count: number, backward: boolean): number | null {
  if (current < 0 || current >= count) return null
  const next = backward ? current - 1 : current + 1
  return next >= 0 && next < count ? next : null
}
