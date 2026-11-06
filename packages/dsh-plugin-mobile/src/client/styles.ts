import { FRAME } from "./frame"

/** Root attribute present while the phone layout applies. */
export const MOBILE_ATTRIBUTE = "data-dsh-mobile"
/** Root attribute present on a touch screen (unless the plugin is set to off). */
export const TOUCH_ATTRIBUTE = "data-dsh-touch"
/** Root attribute present while pull-to-refresh is blocked. */
export const NO_PULL_ATTRIBUTE = "data-dsh-no-pull"

const M = `html[${MOBILE_ATTRIBUTE}]`
const T = `html[${TOUCH_ATTRIBUTE}]`
const SIDEBAR = `${M} ${FRAME} > :has(> [data-slot="sidebar"])`
const SETTINGS = `${M} [data-shortcut-modal="settings"][role="dialog"]`

/**
 * Plugin controls use theme tokens only. Host elements are addressed through
 * slot anchors (`data-slot`), data attributes and ARIA roles; the two
 * `[class*=...]` selectors are scoped to Session rows and only add affordances.
 */
export const MOBILE_CSS = `
.dsh-mobile-menu {
  box-sizing: border-box;
  flex: none;
  width: 34px;
  height: 34px;
  margin: -2px 2px -2px -4px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.dsh-mobile-menu[hidden] {
  display: none;
}
.dsh-mobile-menu:active {
  background: var(--dsw-alias-interactive-bg-hover);
}
@media (hover: hover) {
  .dsh-mobile-menu:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-mobile-menu:focus-visible {
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dsh-mobile-floating {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 40px;
  height: 40px;
  margin: 0;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-soft, 0 2px 8px rgb(0 0 0 / 12%));
}
.dsh-mobile-scrim {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1, rgb(0 0 0 / 40%));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}
.dsh-mobile-scrim[data-open] {
  opacity: 1;
  pointer-events: auto;
}
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

${M} {
  --dsh-frame-top-clearance: 44px;
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

${M} ${FRAME} {
  grid-template-columns: 0px minmax(0, 1fr) 0px !important;
}
${M} ${FRAME} > :has(> [data-slot="main"]) {
  grid-column: 2;
  grid-row: 1;
}
${M} ${FRAME} > [data-rightbar-col] {
  grid-column: 3;
  grid-row: 1;
}
${M} ${FRAME} > [data-side] {
  display: none;
}
${SIDEBAR} {
  position: absolute;
  z-index: 25;
  top: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  width: min(86vw, 340px);
  padding-bottom: env(safe-area-inset-bottom);
  border-right: none;
  box-shadow: var(--dsw-elevation-prominent, 0 8px 32px rgb(0 0 0 / 20%));
  overscroll-behavior: contain;
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}
${M} ${FRAME}[data-sidebar-collapsed] > :has(> [data-slot="sidebar"]) {
  transform: translateX(calc(-100% - 32px));
  visibility: hidden;
  box-shadow: none;
  transition:
    transform 0.2s cubic-bezier(0.4, 0, 1, 1),
    visibility 0s linear 0.2s,
    box-shadow 0s linear 0.2s;
}

${M} header:has(> [data-conversation-header-leading]) {
  min-height: 0;
  padding-top: 6px;
  padding-left: 8px;
  padding-right: 12px;
}
${M} [data-conversation-header-corner] {
  margin-right: 0;
}
${M} [data-conversation-tabs] {
  gap: 20px;
}
${M} [data-conversation-content] {
  --dsh-composer-side-clearance: 8px;
}
${M} [data-width-handle] {
  display: none;
}
${M} [data-composer-seat] {
  --dsh-composer-text-max-height: min(336px, calc(var(--dsh-mobile-vvh, 100dvh) * 0.3));
  padding-bottom: env(safe-area-inset-bottom);
}
html[${MOBILE_ATTRIBUTE}][data-dsh-keyboard] [data-composer-seat] {
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
${T} [data-row-key] > [class*="_rowActions"] button {
  width: 28px;
  height: 28px;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-scrim,
  ${SIDEBAR} {
    transition: none !important;
  }
}
`
