/**
 * Status bar and popover styles. Only theme tokens are shared with the host;
 * classes use the `dsh-cu-` prefix.
 */
export const USAGE_CSS = [
  ".dsh-cu-root{position:relative;width:100%;flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}",
  ".dsh-cu-bar{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;height:24px;margin:0;padding:0 10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;overflow:hidden;cursor:pointer}",
  ".dsh-cu-bar:hover{opacity:0.8}",
  ".dsh-cu-bar:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
  ".dsh-cu-mark{display:block;flex:none;color:var(--dsw-alias-label-tertiary)}",
  ".dsh-cu-none{flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
  ".dsh-cu-item{display:flex;align-items:center;gap:6px;min-width:0;flex:0 1 auto}",
  ".dsh-cu-label{flex:none;color:var(--dsw-alias-label-secondary)}",
  ".dsh-cu-meter{position:relative;flex:none;width:56px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}",
  ".dsh-cu-fill{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary)}",
  ".dsh-cu-percent{flex:none;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
  ".dsh-cu-when{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
  ".dsh-cu-tone-warning .dsh-cu-fill{background:var(--dsw-alias-state-warn-primary)}",
  ".dsh-cu-tone-error .dsh-cu-fill{background:var(--dsw-alias-state-error-primary)}",
  ".dsh-cu-tone-warning .dsh-cu-label,.dsh-cu-tone-warning .dsh-cu-percent,.dsh-cu-tone-warning .dsh-cu-when{color:var(--dsw-alias-state-warn-primary)}",
  ".dsh-cu-tone-error .dsh-cu-label,.dsh-cu-tone-error .dsh-cu-percent,.dsh-cu-tone-error .dsh-cu-when{color:var(--dsw-alias-state-error-primary)}",
  ".dsh-cu-popover{position:fixed;z-index:40;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-sizing:border-box;width:min(260px,calc(100vw - 16px));max-height:min(60vh,480px);overflow:hidden;padding:4px;border:0;border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);isolation:isolate;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}",
  ".dsh-cu-material{position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);pointer-events:none}",
  ".dsh-cu-popover-body{min-height:0;overflow:auto;padding:4px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}",
  ".dsh-cu-row{display:grid;grid-template-columns:minmax(0,1fr) 56px 34px 48px;align-items:center;gap:6px;min-height:20px;padding:1px 2px;border-radius:4px}",
  ".dsh-cu-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}",
  ".dsh-cu-row-value{text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
  ".dsh-cu-row-when{text-align:right;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
  ".dsh-cu-tone-warning .dsh-cu-row-value{color:var(--dsw-alias-state-warn-primary)}",
  ".dsh-cu-tone-error .dsh-cu-row-value{color:var(--dsw-alias-state-error-primary)}",
  ".dsh-cu-extra .dsh-cu-row-value{grid-column:3 / span 2}",
  ".dsh-cu-muted{padding:2px 4px;color:var(--dsw-alias-label-tertiary)}",
  "@media (max-width:599px){.dsh-cu-secondary{display:none}.dsh-cu-bar{gap:6px;padding:0 8px}}",
].join("\n")
