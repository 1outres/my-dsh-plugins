export const MENU_CSS = `
.tb-menu-root {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.tb-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  min-width: min(160px, calc(100vw - 24px));
  max-width: min(360px, calc(100vw - 24px));
  max-height: min(420px, 70vh);
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--dsw-radius-lg);
  outline: none;
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
}
.tb-menu-end {
  left: auto;
  right: 0;
}
.tb-menu-wide {
  width: 320px;
}
.tb-menu-item {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.tb-menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tb-menu-item:focus-visible:not(:disabled) {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.tb-menu-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.tb-menu-label,
.tb-menu-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-menu-detail {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
}
.tb-menu-check {
  flex: none;
  color: var(--dsw-alias-label-primary);
}
.tb-menu-danger {
  color: var(--dsw-alias-state-error-primary);
}
.tb-menu-danger:focus-visible:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.tb-menu-separator {
  flex: none;
  height: 0.5px;
  margin: 3px 2px;
  border: 0;
  background: var(--dsw-alias-border-l2);
}
@media (hover: hover) {
  .tb-menu-item:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .tb-menu-danger:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
}
`
