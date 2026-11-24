export const CARD_CSS = `
.tb-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.tb-card-open {
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 0.5px var(--dsw-alias-state-business-primary);
}
.tb-card-dragging {
  opacity: 0.4;
}
.tb-card-title,
.tb-card-detail {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
}
.tb-card-title {
  font-size: 14px;
  line-height: 22px;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}
.tb-card-detail {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.tb-card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.tb-card-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tb-composer {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.tb-composer-input {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 200px;
  margin: 0;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-state-business-primary);
  border-radius: 12px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  resize: none;
  overflow-y: auto;
}
.tb-composer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
@media (hover: hover) {
  .tb-card:hover {
    border-color: var(--dsw-alias-border-l2);
  }
  .tb-card-open:hover {
    border-color: var(--dsw-alias-state-business-primary);
  }
}
`
