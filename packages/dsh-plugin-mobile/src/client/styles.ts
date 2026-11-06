/** Root attribute present while the Harness uses its phone layout. */
export const MOBILE_ATTRIBUTE = "data-dsh-mobile"
/** Root attribute present on a touch screen. */
export const TOUCH_ATTRIBUTE = "data-dsh-touch"
/** Root attribute present while pull-to-refresh is blocked. */
export const NO_PULL_ATTRIBUTE = "data-dsh-no-pull"

const M = `html[${MOBILE_ATTRIBUTE}]`
const T = `html[${TOUCH_ATTRIBUTE}]`
const SETTINGS = `${M} [data-shortcut-modal="settings"][role="dialog"]`

/**
 * Phone refinements on top of the Harness layout, plus the plugin's own
 * Settings controls. Host elements are addressed through data attributes and
 * ARIA roles; the `[class*=...]` selectors are scoped to sidebar rows.
 *
 * The Harness owns the navigation drawer below 768px: its column, mask,
 * opener, focus trap and close-on-navigation. This stylesheet leaves that
 * drawer alone and only fits the frame to the keyboard and the safe areas.
 *
 * iOS treats a tap that reveals content through `:hover` as a hover and
 * swallows the click, so a Session row needed two taps. On touch screens the
 * rows no longer change what they show on hover: the selected Session and every
 * Workspace keep their buttons visible, other Sessions keep their time.
 */
export const MOBILE_CSS = `
.dsh-mobile-segmented {
  box-sizing: border-box;
  min-width: 0;
  margin: 0;
  border: 0;
  display: inline-flex;
  align-self: flex-start;
  max-width: 100%;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-mobile-segment {
  box-sizing: border-box;
  min-height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
}
.dsh-mobile-segment[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2);
}
.dsh-mobile-segment:disabled {
  cursor: default;
  opacity: 0.5;
}
.dsh-mobile-segment:focus-visible,
.dsh-mobile-switch:focus-visible {
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dsh-mobile-switch {
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
  touch-action: manipulation;
}
.dsh-mobile-switch[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
}
.dsh-mobile-switch:disabled {
  cursor: default;
  opacity: 0.5;
}
.dsh-mobile-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform 0.12s ease;
}
.dsh-mobile-switch[aria-checked="false"] .dsh-mobile-thumb {
  background: var(--dsw-alias-switch-thumb);
}
.dsh-mobile-switch[aria-checked="true"] .dsh-mobile-thumb {
  transform: translate(16px);
}

${M} body {
  height: var(--dsh-mobile-vvh, 100dvh);
  overflow: hidden;
}
${M} #root {
  box-sizing: border-box;
  height: var(--dsh-mobile-vvh, 100dvh);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
}
html[${NO_PULL_ATTRIBUTE}],
html[${NO_PULL_ATTRIBUTE}] body {
  overscroll-behavior: none;
}

${M} [data-conversation-content] {
  --dsh-composer-side-clearance: 8px;
}
${M} div[data-sidebar-drawer] > :has(> [data-slot="sidebar"]) {
  padding-bottom: env(safe-area-inset-bottom);
}
${M} [data-composer-seat] {
  --dsh-composer-text-max-height: min(336px, calc(var(--dsh-mobile-vvh, 100dvh) * 0.3));
  padding-bottom: env(safe-area-inset-bottom);
}
${M}[data-dsh-keyboard] [data-composer-seat] {
  padding-bottom: 0;
}

${SETTINGS} {
  box-sizing: border-box;
  flex-direction: column;
  width: 100vw;
  max-width: 100vw;
  height: var(--dsh-mobile-vvh, 100dvh);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
  border-radius: 0;
}
${SETTINGS} > nav {
  width: auto;
  gap: 10px;
  padding: 14px 12px 4px;
}
${SETTINGS} > nav > :first-child {
  padding-right: 48px;
}
${SETTINGS} > nav > :last-child {
  flex-direction: row;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
${SETTINGS} > nav > :last-child > button {
  flex: none;
  height: 36px;
}
${SETTINGS} > :last-child {
  min-height: 0;
}
${SETTINGS} > :last-child > :first-child {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 10px);
  right: calc(env(safe-area-inset-right) + 10px);
  height: auto;
  padding: 0;
}
${SETTINGS} > :last-child > :last-child {
  padding: 8px 16px 16px;
}

${T} {
  -webkit-tap-highlight-color: transparent;
}
${T} :is(button, a, [role="button"], [role="tab"], [role="treeitem"], [role="menuitem"], [role="option"]) {
  touch-action: manipulation;
}
${T} :is(
    input:not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="color"], [type="button"], [type="submit"]),
    textarea,
    select,
    [data-composer-input],
    [data-composer-placeholder]
  ) {
  font-size: max(16px, 1em);
}
${T} [role="tooltip"] {
  display: none !important;
}
${T} [data-row-key^="session:"][aria-selected="true"] > [class*="_rowActions"] {
  display: inline-flex;
}
${T} [data-row-key^="session:"][aria-selected="true"] > :is([class*="_time"], [class*="_pinIndicator"]) {
  display: none;
}
${T} [data-row-key] > [class*="_rowActions"] {
  gap: 4px;
}
${T} [data-row-key^="session:"]:not([aria-selected="true"]):hover > [class*="_rowActions"],
${T} [data-row-key^="workspace:"]:hover > [class*="_chevron"],
${T} [class*="_searchResultRow"]:hover [class*="_rowActions"] {
  display: none;
}
${T} [data-row-key^="session:"]:not([aria-selected="true"]):hover > [class*="_time"] {
  display: inline;
}
${T} [data-row-key^="session:"]:not([aria-selected="true"]):hover > [class*="_pinIndicator"],
${T} [data-row-key^="workspace:"]:hover > [class*="_folder"],
${T} [data-row-key^="workspace:"] > [class*="_rowActions"] {
  display: inline-flex;
}
${T} [data-row-key] > [class*="_rowActions"] button {
  width: 28px;
  height: 28px;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-thumb {
    transition: none;
  }
}
`
