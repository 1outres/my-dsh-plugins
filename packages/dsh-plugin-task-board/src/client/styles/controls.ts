export const CONTROLS_CSS = `
.tb-page button,
.tb-header-button {
  font: inherit;
}
.tb-icon-button,
.tb-header-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.tb-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.tb-header-button[data-failed] {
  color: var(--dsw-alias-state-error-primary);
}
.tb-primary {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}
.tb-primary:disabled {
  opacity: 0.4;
  cursor: default;
}
.tb-text-button {
  flex: none;
  height: 20px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.tb-ghost-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}
.tb-capsule {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 8px 0 10px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.tb-capsule > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-capsule svg {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.tb-name-input {
  width: 100%;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-md);
  outline: none;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}
.tb-count {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.tb-field-error {
  margin: 6px 0 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.tb-quiet {
  opacity: 0;
}
@media (hover: hover) {
  .tb-icon-button:hover:not(:disabled),
  .tb-header-button:hover,
  .tb-text-button:hover,
  .tb-ghost-row:hover,
  .tb-capsule:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .tb-icon-button:hover:not(:disabled),
  .tb-header-button:hover,
  .tb-ghost-row:hover {
    color: var(--dsw-alias-label-primary);
  }
  .tb-primary:hover:not(:disabled) {
    opacity: 0.88;
  }
}
.tb-icon-button[aria-expanded="true"],
.tb-capsule[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  opacity: 1;
}
.tb-quiet:focus-visible {
  opacity: 1;
}
@media (hover: none) {
  .tb-quiet {
    opacity: 1;
  }
}
`
