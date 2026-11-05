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
