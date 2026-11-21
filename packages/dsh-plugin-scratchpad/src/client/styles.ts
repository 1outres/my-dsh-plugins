import { QUICK_START_ATTR } from "./quick-start"

/** Button styles. Only theme tokens are shared with the host stylesheet. */
export const SCRATCH_CSS = `
.dsh-scratch-footer {
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
.dsh-scratch-footer:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-scratch-footer:disabled {
  cursor: progress;
  opacity: 0.6;
}
.dsh-scratch-footer[data-rail] {
  flex: none;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  gap: 0;
  justify-content: center;
  border-radius: 50%;
}
.dsh-scratch-footer svg {
  flex: none;
}
.dsh-scratch-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-scratch-label[data-error] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-scratch-label-short {
  display: none;
}
[data-slot="sidebar.footer.action"]:has(> [${QUICK_START_ATTR}]:not(.dsh-scratch-footer)) > .dsh-scratch-footer .dsh-scratch-label-full {
  display: none;
}
[data-slot="sidebar.footer.action"]:has(> [${QUICK_START_ATTR}]:not(.dsh-scratch-footer)) > .dsh-scratch-footer .dsh-scratch-label-short {
  display: inline;
}
[${QUICK_START_ATTR}] ~ .dsh-scratch-footer[${QUICK_START_ATTR}]:not([data-rail]) {
  position: relative;
}
[${QUICK_START_ATTR}] ~ .dsh-scratch-footer[${QUICK_START_ATTR}]:not([data-rail])::before {
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
.dsh-scratch-chip {
  box-sizing: border-box;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-scratch-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-scratch-chip:disabled {
  cursor: progress;
  opacity: 0.6;
}
`
