export const BOARD_CSS = `
.tb-board {
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
  padding: 0 var(--tb-inset) 24px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-padding-inline: var(--tb-inset);
}
.tb-column {
  display: flex;
  flex: 0 0 280px;
  flex-direction: column;
  width: 280px;
  min-height: 0;
}
.tb-column-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin-bottom: 4px;
  padding: 0 0 0 4px;
}
.tb-column-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}
.tb-column-head .tb-menu-root {
  margin-left: auto;
}
.tb-column-rename {
  margin-left: -6px;
}
.tb-column-more {
  width: 24px;
  height: 24px;
}
.tb-column:hover .tb-column-more,
.tb-column:focus-within .tb-column-more,
.tb-column-head-active .tb-column-more {
  opacity: 1;
}
.tb-cards {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  margin: 0 -4px;
  padding: 6px 4px;
  overflow-y: auto;
  list-style: none;
}
.tb-cards[data-drop="empty"]::before {
  content: "";
  display: block;
  flex: none;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
}
.tb-slot {
  position: relative;
  flex: none;
}
.tb-slot[data-drop]::before {
  content: "";
  position: absolute;
  right: 0;
  left: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
  pointer-events: none;
}
.tb-slot[data-drop="before"]::before {
  top: -5px;
}
.tb-slot[data-drop="after"]::before {
  bottom: -5px;
}
.tb-add-card {
  flex: none;
  margin-top: 2px;
}
.tb-add-column {
  flex: 0 0 280px;
  width: 280px;
  padding-top: 2px;
}
.tb-add-column-input {
  height: 32px;
  padding: 0 8px;
}
@media (max-width: 767px) {
  .tb-page {
    --tb-inset: 20px;
  }
  .tb-board {
    scroll-snap-type: x mandatory;
  }
  .tb-column,
  .tb-add-column {
    flex-basis: min(85vw, 320px);
    width: min(85vw, 320px);
    scroll-snap-align: start;
  }
}
`
