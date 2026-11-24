export const BASE_CSS = `
.tb-page :focus-visible,
.tb-header-button:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.tb-page .tb-name-input:focus-visible,
.tb-page .tb-composer-input:focus-visible,
.tb-page .tb-title-input:focus-visible,
.tb-page .tb-description:focus-visible,
.tb-page .tb-comment-input:focus-visible,
.tb-page .tb-menu:focus-visible,
.tb-page .tb-menu-item:focus-visible,
.tb-page .tb-panel:focus-visible {
  outline: none;
}
@media (pointer: coarse) {
  .tb-name-input,
  .tb-composer-input,
  .tb-title-input,
  .tb-description,
  .tb-comment-input {
    font-size: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tb-page *,
  .tb-header-button {
    transition: none;
    animation: none;
  }
}
`
