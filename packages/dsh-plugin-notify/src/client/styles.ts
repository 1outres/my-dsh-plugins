/**
 * Switch look-alike for the Settings page. The shipped settings UI renders its
 * toggles as a 36×20 button with `role="switch"`; the plugin reproduces the
 * same geometry from the theme tokens instead of importing a hashed CSS-module
 * class, so it follows light and dark themes and DSH upgrades.
 */
export const NOTIFY_CSS = `
.dsh-notify-switch {
  box-sizing: border-box;
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}

.dsh-notify-switch[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
}

.dsh-notify-switch:disabled {
  cursor: default;
  opacity: 0.5;
}

.dsh-notify-switch:focus-visible {
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.dsh-notify-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform 0.12s ease;
}

.dsh-notify-switch[aria-checked="false"] .dsh-notify-thumb {
  background: var(--dsw-alias-switch-thumb);
}

.dsh-notify-switch[aria-checked="true"] .dsh-notify-thumb {
  transform: translate(16px);
}
`
