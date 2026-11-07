export const REMOTE_CSS = `
[data-remote-plugin] .remote-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  padding: 12px;
  margin: 4px 0;
  font-size: 13px;
  line-height: 1.5;
}
[data-remote-plugin] .remote-card.remote-card-waiting {
  border-color: var(--dsw-alias-state-warn-primary);
}
[data-remote-plugin] .remote-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
[data-remote-plugin] .remote-badge {
  margin-left: auto;
  font-weight: 500;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 0 8px;
}
[data-remote-plugin] .remote-muted {
  color: var(--dsw-alias-label-tertiary);
}
[data-remote-plugin] .remote-summary {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
}
[data-remote-plugin] .remote-grid {
  display: grid;
  grid-template-columns: minmax(90px, max-content) 1fr;
  gap: 4px 12px;
  margin-top: 10px;
}
[data-remote-plugin] .remote-grid dt {
  color: var(--dsw-alias-label-tertiary);
}
[data-remote-plugin] .remote-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}
[data-remote-plugin] .remote-fingerprint {
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
}
[data-remote-plugin] .remote-field {
  display: grid;
  gap: 4px;
  margin-top: 10px;
}
[data-remote-plugin] .remote-field label {
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
}
[data-remote-plugin] .remote-input,
[data-remote-plugin] .remote-textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 6px 8px;
  font: inherit;
}
[data-remote-plugin] .remote-input:focus,
[data-remote-plugin] .remote-textarea:focus {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
[data-remote-plugin] .remote-textarea {
  min-height: 54px;
  resize: vertical;
}
[data-remote-plugin] .remote-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
[data-remote-plugin] .remote-button {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 5px 12px;
  font: inherit;
  cursor: pointer;
}
[data-remote-plugin] .remote-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-remote-plugin] .remote-button:disabled {
  opacity: 0.55;
  cursor: default;
}
[data-remote-plugin] .remote-button-primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
[data-remote-plugin] .remote-button-danger {
  color: var(--dsw-alias-state-error-primary);
}
[data-remote-plugin] .remote-error {
  margin-top: 8px;
  color: var(--dsw-alias-state-error-primary);
}
[data-remote-plugin] .remote-warning {
  margin-top: 8px;
  color: var(--dsw-alias-state-warn-label);
}
[data-remote-plugin] .remote-pre {
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}
[data-remote-plugin] .remote-details {
  margin-top: 8px;
}
[data-remote-plugin] .remote-details > summary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
`
