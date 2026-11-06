# @1outres/dsh-plugin-mobile

Adds phone refinements to the DeepSeek Harness Web UI. Harness `0.2.2` already
turns the sidebar into a modal navigation drawer below 768px, with its own
opener, mask, focus trap and close-on-navigation. This plugin supplies what is
still missing on a phone: the page follows the on-screen keyboard, Enter adds a
line, the keyboard stays closed until you tap the composer, edge swipes open
and close the shipped drawer, and the layout respects notches and touch.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-mobile
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `mobile` row.

## On a phone

The phone refinements apply while the Harness uses its phone layout: below
768px and without a Windows caption bar.

- **On-screen keyboard.** The page shrinks to the area the keyboard leaves
  visible, so the header stays at the top and the composer sits right above
  the keyboard. The draft box grows to at most 30% of that area.
- **Enter adds a line.** On a touch screen Enter in the composer inserts a line
  break and the send button sends. Enter that confirms an IME conversion, and
  Enter in the slash-command or reference menu, keep working as before.
- **The keyboard opens only when you tap the input.** The Harness focuses the
  composer when a composer button such as the model picker or Send is pressed,
  which pops the keyboard over the conversation. On a touch screen the composer
  takes focus only right after a tap on the input (or on the empty part of the
  composer card, or the `+` command button) or a hardware key press; other
  focuses are undone at once.
- **Swipe the drawer.** Swipe right from the left edge to open the Harness
  navigation drawer, swipe left to close it. The Harness owns the drawer, its
  menu button, its scrim and its close-on-navigation behavior.
- **Notches and the home indicator.** The page asks for the full screen
  (`viewport-fit=cover`) and pads by the safe-area insets; the navigation
  drawer and the composer clear the home indicator.
- **Compact composer.** The conversation keeps 8px side clearance and the
  draft box caps its height against the visible area.
- **No accidental reloads.** Pull-to-refresh and overscroll bounce are off, so
  scrolling up through a long conversation does not reload the page.
- **A full-screen Settings sheet.** The Harness Settings dialog becomes a
  full-screen sheet with its section list scrolling sideways above the page.

On any touch screen (also a tablet wider than 768px):

- Text fields use at least 16px type, so iOS does not zoom in when one gets
  focus.
- Tooltips, which stick after a tap, are hidden.
- One tap opens a session. iOS treats a tap that reveals content on `:hover`
  as a hover and drops the click, and the sidebar rows reveal their buttons on
  hover, so a row needed two taps. Rows no longer change on hover: the selected
  session and every workspace keep their "..." menu and buttons visible, with
  28px tap targets, and other sessions keep their time.
- No tap highlight flash and no double-tap zoom delay on buttons.

The plugin also patches the viewport metadata and adds the home-screen tags
(`apple-mobile-web-app-capable`, `mobile-web-app-capable`,
`apple-mobile-web-app-title`), so **Add to Home Screen** opens the Harness
without the browser bar. The Harness already ships the manifest and the
home-screen icon.

### With the other plugins in this repository

- [`@1outres/dsh-plugin-background`](../dsh-plugin-background) keeps the
  Harness drawer, the Settings sheet and the fullscreen right panel opaque, so
  the conversation does not show through them.
- [`@1outres/dsh-plugin-model-picker`](../dsh-plugin-model-picker) does not
  focus its search field on a touch screen, fits above the keyboard, and stays
  open when the keyboard is dismissed, so the Effort row stays reachable.

## Settings

Edit them in **Settings → Mobile**, or in the profile patch under the
`mobile` row. Every change applies immediately in every open page. The page
also says whether the Harness currently uses its phone layout, and at which
width.

| Field                | Default   | Meaning                                                                                                                                         |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterKey`           | `newline` | Enter in the composer on a touch screen: `newline` adds a line, `send` keeps the Harness default.                                               |
| `swipe`              | `true`    | Edge swipe opens the Harness navigation drawer, swipe left closes it.                                                                           |
| `fitKeyboard`        | `true`    | Fit the page to the area the on-screen keyboard leaves visible.                                                                                 |
| `blockPullToRefresh` | `true`    | Stop pull-to-refresh and overscroll bounce.                                                                                                     |
| `autoFocusComposer`  | `false`   | Let a composer button or another Harness action focus the input (and open the keyboard). Off keeps the keyboard closed until you tap the input. |

The Harness fixes the drawer width at 768px; this plugin has no separate
breakpoint. The earlier `mode` and `breakpoint` fields are gone; an old profile
entry that still sets them is ignored.

## How it works

1. The browser half watches the frame's `data-sidebar-drawer` attribute and a
   coarse-pointer media query, and sets `data-dsh-mobile` and `data-dsh-touch`
   on `<html>`. One stylesheet, scoped under those attributes, does the layout
   work.
2. The drawer belongs to the Harness. The plugin only calls
   `ctx.layout.toggleSidebar()` for an edge swipe and reads the frame's
   `data-sidebar-collapsed` attribute to know whether it is open.
3. The keyboard fit reads `window.visualViewport` and publishes its height as
   `--dsh-mobile-vvh`; the page height follows it. iOS scrolls the whole
   document to reveal a focused field, so that scroll is undone while the
   keyboard is up.
4. Enter: a capturing `keydown` listener hides a plain Enter in the composer
   from the composer's own handlers. The key's default action still runs, and
   the editor turns the browser's paragraph break into a line break.
5. Focus: capturing `pointerdown` and `keydown` listeners remember what the
   user last did; a `focusin` on the composer that no recent tap on it or key
   press explains is blurred in the same event.
6. The Host half only declares the settings and turns off the
   schema-generated form, since the plugin ships its own Settings page.

## Limits

- **It restyles shipped UI from the outside.** Host elements are found through
  data attributes (`data-sidebar-drawer`, `data-sidebar-collapsed`,
  `data-rightbar-col`, `data-composer-*`, `data-conversation-*`,
  `data-shortcut-modal`) and ARIA roles. Two touch rules match Session row
  parts by CSS-module class name. A Harness update within
  `>=0.2.2-rc.1 <0.3.0` can rename any of them; the matching rule then stops
  applying, and the page falls back to the shipped layout for that part.
- Enter relies on the composer being a plain-text editor that turns the
  browser's paragraph insertion into a line break.
- The Harness owns the drawer breakpoint; the plugin follows the frame's
  `data-sidebar-drawer` attribute rather than repeating the width.
- An edge swipe in Safari can also trigger the browser's own back gesture; the
  home-screen app has none.
- Buttons and the Settings page are in English, Chinese and Japanese (the
  Japanese copy shows only with a Japanese language pack); the field
  descriptions in the profile schema are English.
