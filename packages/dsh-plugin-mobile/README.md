# @1outres/dsh-plugin-mobile

Makes the DeepSeek Harness Web UI usable on a phone. The shipped layout is
built for desktop windows: below 1024px the sidebar shrinks to a 56px rail and,
when opened, squeezes the conversation to a sliver; the on-screen keyboard
pushes the header off screen; Enter sends, so a second line cannot be typed.
This plugin keeps the desktop layout as it is and changes only the narrow one.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-mobile
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `mobile` row.

## On a phone

The phone layout applies while the viewport is narrower than `breakpoint`
(768px by default, the width below which the right panel already opens
fullscreen).

- **Sidebar drawer.** The rail disappears and the conversation takes the full
  width. A menu button before the session title, or a swipe right from the
  left edge, slides the sidebar in over the conversation with a dimmed scrim.
  Tap the scrim, swipe left, or pick a session, a panel or New Session to close
  it. Global panels such as Plugins have no conversation header, so they get a
  floating menu button in the top-left corner instead.
- **On-screen keyboard.** The page shrinks to the area the keyboard leaves
  visible, so the header stays at the top and the composer sits right above
  the keyboard. The draft box grows to at most 30% of that area.
- **Enter adds a line.** On a touch screen Enter in the composer inserts a line
  break and the send button sends. Enter that confirms an IME conversion, and
  Enter in the slash-command or reference menu, keep working as before.
- **Notches and the home indicator.** The page asks for the full screen
  (`viewport-fit=cover`) and pads by the safe-area insets; the composer clears
  the home indicator while the keyboard is down.
- **Compact chrome.** Tighter header and composer padding, no width-drag
  handles, and the Settings dialog becomes a full-screen sheet with its section
  list scrolling sideways above the page.
- **No accidental reloads.** Pull-to-refresh and overscroll bounce are off, so
  scrolling up through a long conversation does not reload the page.

On any touch screen (also a tablet wider than the breakpoint):

- Text fields use at least 16px type, so iOS does not zoom in when one gets
  focus.
- Tooltips, which stick after a tap, are hidden.
- The selected session row always shows its "..." menu and row buttons, with
  28px tap targets; other rows still show them on tap.
- No tap highlight flash and no double-tap zoom delay on buttons.

The plugin also adds the home-screen tags (`apple-mobile-web-app-capable`,
`mobile-web-app-capable`, `apple-mobile-web-app-title`), so **Add to Home
Screen** opens the Harness without the browser bar.

## Settings

Edit them in **Settings → Mobile**, or in the profile patch under the
`mobile` row. Every change applies immediately in every open page. The page
also says whether the page you are looking at uses the phone layout, and at
which width, to help pick the breakpoint.

| Field                | Default   | Meaning                                                                                           |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `mode`               | `auto`    | `auto` uses the phone layout below `breakpoint`, `always` everywhere, `off` never.                |
| `breakpoint`         | `768`     | Viewport width in CSS pixels, from 360 to 1024.                                                   |
| `enterKey`           | `newline` | Enter in the composer on a touch screen: `newline` adds a line, `send` keeps the Harness default. |
| `swipe`              | `true`    | Edge swipe opens the drawer, swipe left closes it.                                                |
| `fitKeyboard`        | `true`    | Fit the page to the area the on-screen keyboard leaves visible.                                   |
| `blockPullToRefresh` | `true`    | Stop pull-to-refresh and overscroll bounce.                                                       |

`mode: off` removes every change, the touch ones included.

## How it works

1. The browser half watches `matchMedia` and sets `data-dsh-mobile` and
   `data-dsh-touch` on `<html>`. One stylesheet, scoped under those
   attributes, does the layout work.
2. The drawer is the shipped sidebar column. The stylesheet takes it out of the
   AppFrame grid and slides it with a transform; `ctx.layout.toggleSidebar()`
   opens and closes it, and the frame's `data-sidebar-collapsed` attribute says
   which state it is in. The menu button occupies the empty
   `conversation.header.leading` slot; the scrim and the floating button live
   in `shell.overlay`.
3. The keyboard fit reads `window.visualViewport` and publishes its height as
   `--dsh-mobile-vvh`; the page height follows it. iOS scrolls the whole
   document to reveal a focused field, so that scroll is undone while the
   keyboard is up.
4. Enter: a capturing `keydown` listener hides a plain Enter in the composer
   from the composer's own handlers. The key's default action still runs, and
   the editor turns the browser's paragraph break into a line break.
5. The Host half only declares the settings and turns off the
   schema-generated form, since the plugin ships its own Settings page.

## Limits

- **It restyles shipped UI from the outside.** Host elements are found through
  slot anchors (`data-slot`), data attributes (`data-rightbar-col`,
  `data-sidebar-collapsed`, `data-composer-*`, `data-conversation-*`,
  `data-shortcut-modal`) and ARIA roles. Two touch rules match Session row
  parts by CSS-module class name. A Harness update within
  `>=0.2.1-rc.5 <0.3.0` can rename any of them; the matching rule then stops
  applying, and the page falls back to the shipped layout for that part.
- Enter relies on the composer being a plain-text editor that turns the
  browser's paragraph insertion into a line break.
- The drawer closes after a session or panel is picked, not after other
  actions in it (Settings opens over it).
- Between the breakpoint and about 756px a normal right panel overlaps the
  conversation instead of squeezing it; below 768px the Harness already opens
  it fullscreen.
- iOS shows a screenshot instead of an icon on the home screen: it does not
  use SVG touch icons, and the Harness ships no PNG.
- An edge swipe in Safari can also trigger the browser's own back gesture; the
  home-screen app has none.
- Buttons and the Settings page are in English, Chinese and Japanese (the
  Japanese copy shows only with a Japanese language pack); the field
  descriptions in the profile schema are English.
