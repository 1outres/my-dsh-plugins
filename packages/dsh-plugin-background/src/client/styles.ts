/**
 * Global layer: the image sits behind the application, a veil sits above the
 * image, and the application root is lifted above both. Interface surfaces turn
 * translucent through theme-token overrides applied by the plugin, so the image
 * shows through panels without any element being reparented.
 */
export const BACKGROUND_CSS = `
html[data-dsh-background="on"]::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: var(--dsh-background-image, none);
  background-position: center center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: blur(var(--dsh-background-blur, 0px));
  transform: scale(1.06);
  transform-origin: center center;
}

html[data-dsh-background="on"]::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: var(--dsh-background-dim, rgba(0, 0, 0, 0.3));
}

html[data-dsh-background="on"] #root {
  position: relative;
  z-index: 2;
}
`

/**
 * Stable marker the shell puts on its body-portaled Settings dialog
 * (`data-shortcut-modal="settings"`), the only dialog that carries it.
 */
const SETTINGS_DIALOG = '[data-shortcut-modal="settings"]'

/**
 * Restore opaque theme surfaces inside the Settings dialog.
 *
 * The dialog is portaled to `document.body`, outside the app root, and it
 * paints itself from the same alias tokens the plugin made translucent. Theme
 * tokens are applied as inline styles on `body`, so re-declaring them on the
 * dialog element wins for its whole subtree while the rest of the UI keeps
 * showing the wallpaper.
 *
 * @param solid - alias token name to its opaque theme color.
 * @returns a scoped rule, or an empty string when no token was captured.
 */
export function settingsSurfaceCss(solid: Readonly<Record<string, string>>): string {
  const declarations = Object.entries(solid)
    .filter(([, value]) => isSafeCssValue(value))
    .map(([name, value]) => `  ${name}: ${value};`)
  if (declarations.length === 0) return ""
  return `html[data-dsh-background="on"] ${SETTINGS_DIALOG} {\n${declarations.join("\n")}\n}\n`
}

/** Reject theme values that could close the declaration or rule block. */
function isSafeCssValue(value: string): boolean {
  return value.length > 0 && !/[{;}@]/.test(value) && !value.includes("\n")
}
