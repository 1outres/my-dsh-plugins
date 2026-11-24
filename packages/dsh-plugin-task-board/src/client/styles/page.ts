export const PAGE_CSS = `
.tb-page {
  --tb-inset: clamp(24px, 4vw, 48px);
  position: relative;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
.tb-page *,
.tb-page *::before,
.tb-page *::after {
  box-sizing: border-box;
}
.tb-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.tb-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: 60px;
  padding: 28px var(--tb-inset) 0;
  margin-bottom: 20px;
}
.tb-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-switcher {
  width: 32px;
  height: 32px;
  border-radius: 16px;
}
.tb-notice {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 9px;
  margin: 0 var(--tb-inset) 20px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--dsw-specific-sidebar-fill);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
}
.tb-notice-messages {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tb-notice-messages p {
  margin: 0;
}
.tb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 20px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  text-align: center;
}
.tb-empty-glyph {
  margin-bottom: 12px;
  color: var(--dsw-alias-label-caption);
}
.tb-empty-title {
  margin: 0;
}
.tb-skeleton {
  display: block;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  animation: tb-pulse 1.4s ease-in-out infinite;
}
.tb-skeleton-title {
  width: 160px;
  height: 20px;
  border-radius: var(--dsw-radius-sm);
}
.tb-skeleton-head {
  width: 96px;
  height: 12px;
  border-radius: var(--dsw-radius-sm);
}
.tb-skeleton-short {
  height: 56px;
}
.tb-skeleton-medium {
  height: 72px;
}
.tb-skeleton-tall {
  height: 96px;
}
@keyframes tb-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
`
