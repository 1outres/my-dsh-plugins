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

const ON = 'html[data-dsh-background="on"]'

/**
 * Surfaces drawn over the conversation. Through translucent panels their text
 * would sit on top of the chat text, so they keep the opaque theme colors:
 *
 * - the body-portaled Settings dialog (`data-shortcut-modal="settings"`, the
 *   only dialog that carries it);
 * - the right panel while it covers the page (`data-sidebar-right-panel` is
 *   `fullscreen`, which the Harness always uses below 768px), and its floating
 *   tabs (`data-dockkit-float`);
 * - the sidebar drawer of `@1outres/dsh-plugin-mobile`, which marks the root
 *   with `data-dsh-mobile` while its phone layout slides the sidebar column
 *   over the conversation.
 */
export const OPAQUE_SURFACES: readonly string[] = [
  `${ON} [data-shortcut-modal="settings"]`,
  `${ON} [data-sidebar-right-panel="fullscreen"]`,
  `${ON} [data-dockkit-float]`,
  `${ON}[data-dsh-mobile] div:has(> [data-rightbar-col]) > :has(> [data-slot="sidebar"])`,
]

/**
 * Restore opaque theme colors on the surfaces that cover the conversation.
 *
 * Theme tokens are applied as inline styles on `body`, so re-declaring them on
 * a surface element wins for its whole subtree, portaled or not, while the rest
 * of the UI keeps showing the wallpaper. Only tokens are re-declared: a
 * collapsed panel keeps its own transparency and never blocks the page.
 *
 * @param solid - alias token name to its opaque theme color.
 * @returns a scoped rule, or an empty string when no token was captured.
 */
export function opaqueSurfaceCss(solid: Readonly<Record<string, string>>): string {
  const declarations = Object.entries(solid)
    .filter(([, value]) => isSafeCssValue(value))
    .map(([name, value]) => `  ${name}: ${value};`)
  if (declarations.length === 0) return ""
  return `${OPAQUE_SURFACES.join(",\n")} {\n${declarations.join("\n")}\n}\n`
}

/** Reject theme values that could close the declaration or rule block. */
function isSafeCssValue(value: string): boolean {
  return value.length > 0 && !/[{;}@]/.test(value) && !value.includes("\n")
}
