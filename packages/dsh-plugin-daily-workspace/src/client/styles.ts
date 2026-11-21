import { QUICK_START_ATTR } from "./quick-start"

/** Button styles. Only theme tokens are shared with the host stylesheet. */
export const TODAY_CSS = `
.dsh-today-footer {
  box-sizing: border-box;
  flex: 1 1 0;
  min-width: 0;
  height: 42px;
  margin: 8px -2px 0;
  padding: 0 10px 0 8px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  overflow: hidden;
}
.dsh-today-footer:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-today-footer:disabled {
  cursor: progress;
  opacity: 0.6;
}
.dsh-today-footer[data-rail] {
  flex: none;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  gap: 0;
  justify-content: center;
  border-radius: 50%;
}
.dsh-today-footer svg {
  flex: none;
}
.dsh-today-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-today-label[data-error] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-today-label-short {
  display: none;
}
[data-slot="sidebar.footer.action"]:has(> [${QUICK_START_ATTR}]:not(.dsh-today-footer)) > .dsh-today-footer .dsh-today-label-full {
  display: none;
}
[data-slot="sidebar.footer.action"]:has(> [${QUICK_START_ATTR}]:not(.dsh-today-footer)) > .dsh-today-footer .dsh-today-label-short {
  display: inline;
}
[${QUICK_START_ATTR}] ~ .dsh-today-footer[${QUICK_START_ATTR}]:not([data-rail]) {
  position: relative;
}
[${QUICK_START_ATTR}] ~ .dsh-today-footer[${QUICK_START_ATTR}]:not([data-rail])::before {
  content: "";
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 1px;
  background: var(--dsw-alias-border-l3);
}
:has(> [data-slot="sidebar.footer.action"] > [${QUICK_START_ATTR}][data-rail] ~ [${QUICK_START_ATTR}][data-rail]) {
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
`
