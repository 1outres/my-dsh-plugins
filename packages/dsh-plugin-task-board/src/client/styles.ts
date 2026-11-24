export const TB_CSS = `
.tb-page {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.tb-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex-wrap: wrap;
}
.tb-heading {
  min-width: 0;
  margin-right: auto;
}
.tb-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.tb-project-path {
  margin: 2px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.tb-project-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
}
.tb-project-picker select,
.tb-rename input,
.tb-add-column-form input,
.tb-add-card input,
.tb-add-card textarea,
.tb-dialog input,
.tb-dialog textarea,
.tb-comment-form textarea {
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 5px 8px;
  font: inherit;
}
.tb-project-picker select:focus,
.tb-rename input:focus,
.tb-add-column-form input:focus,
.tb-add-card input:focus,
.tb-add-card textarea:focus,
.tb-dialog input:focus,
.tb-dialog textarea:focus,
.tb-comment-form textarea:focus {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.tb-refresh,
.tb-add-column,
.tb-add-card-button,
.tb-form-actions button,
.tb-menu button,
.tb-link-button,
.tb-danger {
  font: inherit;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 4px 10px;
  cursor: pointer;
}
.tb-refresh:hover,
.tb-add-column:hover,
.tb-add-card-button:hover,
.tb-form-actions button:hover,
.tb-menu button:hover,
.tb-link-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.tb-refresh:disabled,
.tb-add-column:disabled,
.tb-add-card-button:disabled,
.tb-form-actions button:disabled,
.tb-menu button:disabled,
.tb-link-button:disabled {
  opacity: 0.55;
  cursor: default;
}
.tb-danger {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
}
.tb-danger:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.tb-icon-button {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: var(--dsw-radius-sm);
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.tb-icon-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.tb-notices {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-error-primary);
  flex-wrap: wrap;
}
.tb-notices p {
  margin: 0;
}
.tb-notices button {
  font: inherit;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 3px 10px;
  cursor: pointer;
}
.tb-muted {
  color: var(--dsw-alias-label-secondary);
}
.tb-error {
  margin: 8px 0;
  color: var(--dsw-alias-state-error-primary);
}
.tb-empty {
  padding: 40px 18px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}
.tb-columns {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px 20px;
  overflow-x: auto;
  overflow-y: hidden;
}
.tb-column {
  box-sizing: border-box;
  width: 280px;
  flex: 0 0 280px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.tb-column-drop {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary) inset;
}
.tb-column-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}
.tb-column-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-column-count {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  margin-left: auto;
  white-space: nowrap;
}
.tb-menu-wrap {
  position: relative;
}
.tb-menu {
  position: absolute;
  right: 0;
  top: 28px;
  z-index: 5;
  min-width: 170px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: var(--dsw-elevation-panel);
}
.tb-menu button {
  border: none;
  background: transparent;
  text-align: left;
  border-radius: var(--dsw-radius-sm);
}
.tb-menu-danger {
  color: var(--dsw-alias-state-error-primary);
}
.tb-rename {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}
.tb-rename input {
  min-width: 0;
  flex: 1 1 auto;
}
.tb-column-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  min-height: 32px;
}
.tb-column-empty {
  margin: 4px 0;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  font-size: 12px;
}
.tb-drop-zone {
  border-radius: var(--dsw-radius-sm);
}
.tb-card {
  box-sizing: border-box;
  width: 100%;
  display: block;
  text-align: left;
  font: inherit;
  color: inherit;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
  cursor: grab;
  padding: 8px 10px 7px;
}
.tb-card:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.tb-card:hover {
  border-color: var(--dsw-alias-brand-primary);
}
.tb-card:active {
  cursor: grabbing;
}
.tb-card-number {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  margin-right: 6px;
}
.tb-card-title {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.tb-card-detail {
  display: block;
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-card-meta {
  display: flex;
  gap: 10px;
  padding-top: 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.tb-card-linked {
  color: var(--dsw-alias-state-success-primary);
}
.tb-add-card,
.tb-add-column-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tb-add-card textarea,
.tb-dialog textarea,
.tb-comment-form textarea {
  resize: vertical;
}
.tb-form-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.tb-confirm {
  padding: 8px;
  border: 1px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
}
.tb-confirm p {
  margin: 0 0 6px;
}
.tb-add-column {
  flex: 0 0 auto;
  padding: 8px 14px;
  color: var(--dsw-alias-label-secondary);
}
.tb-add-column-form {
  box-sizing: border-box;
  flex: 0 0 240px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.tb-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: var(--dsw-alias-bg-mask-3);
}
.tb-dialog {
  box-sizing: border-box;
  width: min(620px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-prominent);
}
.tb-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tb-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--dsw-alias-label-secondary);
}
.tb-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.tb-section h3 {
  margin: 0 0 8px;
  font-size: 13px;
}
.tb-comments,
.tb-links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tb-comment {
  padding: 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
}
.tb-comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.tb-comment-author {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.tb-comment-body {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tb-comment-form {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tb-link {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tb-link code {
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 12px;
}
.tb-link-button {
  border: none;
  background: transparent;
  padding: 2px 6px;
  color: var(--dsw-alias-label-secondary);
}
.tb-link-button:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.tb-danger-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tb-session-action {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.tb-session-error {
  position: absolute;
  top: 28px;
  right: 0;
  z-index: 30;
  width: max-content;
  max-width: 280px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
`
