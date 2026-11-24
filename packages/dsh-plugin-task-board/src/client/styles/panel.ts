export const PANEL_CSS = `
.tb-panel {
  --tb-gutter: 24px;
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 min(520px, 100%);
  flex-direction: column;
  width: min(520px, 100%);
  min-height: 0;
  border-left: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-base);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
}
.tb-panel:focus-visible {
  outline: none;
}
.tb-panel-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 var(--tb-gutter);
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.tb-panel-number {
  flex: none;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.tb-panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  margin-right: -8px;
}
.tb-panel-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 24px;
  min-height: 0;
  padding: 24px var(--tb-gutter) 28px;
  overflow-y: auto;
}
.tb-panel-scroll > .tb-field-error {
  margin: 0;
}
.tb-panel-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tb-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tb-title-input,
.tb-description {
  display: block;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 2px 8px;
  border: 0.5px solid transparent;
  border-radius: var(--dsw-radius-md);
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.tb-title-input {
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
}
.tb-description {
  min-height: 36px;
  padding: 6px 8px;
  font-size: 14px;
  line-height: 24px;
  resize: none;
  overflow: hidden;
}
.tb-description::placeholder,
.tb-comment-input::placeholder {
  color: var(--dsw-alias-label-caption);
}
.tb-title-input:focus,
.tb-description:focus {
  border-color: var(--dsw-alias-state-business-primary);
  background: transparent;
}
.tb-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tb-group-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
}
.tb-comments {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0 0 16px;
  padding: 0;
  list-style: none;
}
.tb-comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.tb-comment-author {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}
.tb-comment-agent {
  color: var(--dsw-alias-label-caption);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 18px;
}
.tb-comment-time {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
}
.tb-comment-delete {
  width: 24px;
  height: 24px;
  margin-left: auto;
}
.tb-comment:hover .tb-comment-delete,
.tb-comment:focus-within .tb-comment-delete {
  opacity: 1;
}
.tb-comment-body {
  margin: 2px 0 0;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tb-comment-input {
  display: block;
  width: 100%;
  min-height: 72px;
  max-height: 240px;
  margin: 0;
  padding: 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 16px;
  outline: none;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 24px;
  resize: none;
  overflow-y: auto;
  transition: border-color 0.15s;
}
.tb-comment-input:focus {
  border-color: var(--dsw-alias-state-business-primary);
}
.tb-composer-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.tb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tb-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  padding: 0 2px 0 8px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.tb-chip code {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 18px;
}
.tb-chip-remove {
  width: 20px;
  height: 20px;
  border-radius: 10px;
}
.tb-chip:hover .tb-chip-remove,
.tb-chip:focus-within .tb-chip-remove {
  opacity: 1;
}
@media (hover: hover) {
  .tb-title-input:hover:not(:focus),
  .tb-description:hover:not(:focus) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .tb-comment-input:hover:not(:focus) {
    border-color: var(--dsw-alias-border-l2);
  }
}
@media (max-width: 767px) {
  .tb-panel {
    position: absolute;
    inset: 0;
    width: 100%;
    border-left: 0;
  }
}
@media (max-width: 400px) {
  .tb-panel {
    --tb-gutter: 16px;
  }
}
`
