/**
 * Styles. The action button copies the shipped message action, the tooltip
 * copies the shipped tooltip bubble, and the editor copies the user bubble and
 * the shipped small buttons, all renamed under `dsh-em-`; only theme tokens
 * are shared with the host.
 */
export const EDIT_CSS = [
  ".dsh-em-seat{display:inline-flex;position:relative}",
  ".dsh-em-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}",
  ".dsh-em-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}",
  ".dsh-em-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
  ".dsh-em-action:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
  ".dsh-em-action[data-unavailable]{cursor:default;opacity:.4}",
  ".dsh-em-action[data-unavailable]:hover{color:var(--dsw-alias-label-tertiary);background:0 0}",
  ".dsh-em-tip{position:absolute;top:calc(100% + 4px);left:50%;transform:translate(-50%);z-index:100;width:max-content;max-width:280px;box-sizing:border-box;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-toast-label);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;animation:dsh-em-tip-in .15s ease-in-out}",
  "@keyframes dsh-em-tip-in{0%{opacity:0}to{opacity:1}}",
  ".dsh-em-hidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}",
  ".dsh-em-editor{box-sizing:border-box;width:100%;display:flex;flex-direction:column;align-items:stretch;gap:8px}",
  ".dsh-em-box{box-sizing:border-box;background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);padding:10px 16px;border:.5px solid transparent}",
  ".dsh-em-box:focus-within{border-color:var(--dsw-alias-border-l3)}",
  ".dsh-em-input{display:block;box-sizing:border-box;width:100%;min-height:calc(22px + var(--dsh-content-font-delta,0px));max-height:50vh;margin:0;padding:0;border:none;outline:none;resize:none;overflow-y:auto;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word}",
  ".dsh-em-input:disabled{color:var(--dsw-alias-label-secondary)}",
  ".dsh-em-footer{display:flex;align-items:flex-start;gap:8px}",
  ".dsh-em-notes{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px))}",
  ".dsh-em-error{color:var(--dsw-alias-state-error-primary)}",
  ".dsh-em-buttons{flex:none;display:flex;align-items:center;gap:8px}",
  ".dsh-em-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:transparent}",
  ".dsh-em-button:disabled{cursor:not-allowed;opacity:.4}",
  ".dsh-em-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
  ".dsh-em-cancel{border:.5px solid var(--dsw-alias-border-l3)}",
  ".dsh-em-cancel:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
  ".dsh-em-send{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
  ".dsh-em-send:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
  "@media (prefers-reduced-motion:reduce){.dsh-em-tip{animation:none}}",
].join("\n")
