# @1outres/dsh-plugin-mobile

Adds phone refinements to the DeepSeek Harness Web UI and turns it into an
installable app. Harness `0.2.2` already turns the sidebar into a modal
navigation drawer below 768px, with its own opener, mask, focus trap and
close-on-navigation. This plugin supplies what is still missing on a phone: the
page follows the on-screen keyboard, Enter adds a line, the keyboard stays
closed until you tap the composer, edge swipes open and close the shipped
drawer, and the layout respects notches and touch. It also serves and registers
the app's service worker, which adds an offline page and the notification
channel that the notify plugin pushes through.

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
home-screen icons.

## As an app (PWA)

The Harness already serves a web app manifest and its icons. This plugin adds
the rest of the installable-app behavior:

- **Install.** Settings → Mobile → App shows **Install app** when the browser
  offers its install prompt (Chrome, Edge, Android browsers). Safari on iPhone
  and iPad has no install prompt: open the Share menu and choose **Add to Home
  Screen**. The page says so on iOS while it runs in a browser tab.
- **Installed app or browser tab.** The App status line says which one the
  current window is, and whether the service worker is ready.
- **Offline page.** When the Host cannot be reached, a page load shows a small
  built-in page in English, Chinese or Japanese, with a **Retry** button. The
  page lives inside the service worker, so it still works when the Host is
  down.
- **Title bar color.** The browser and the installed-app title bar follow the
  page background color, in the light and the dark theme.
- **Push notifications.** The notify plugin sends Web Push messages through
  the service worker this plugin registers. Here the service worker only shows
  the notification, opens the right window or URL on a click, and posts the
  click to the page. The notify plugin owns subscriptions and sending; see
  [`@1outres/dsh-plugin-notify`](../dsh-plugin-notify).

Installing the app needs HTTPS (or `localhost`) and a site root scope. The
worker script is served at `/dsh-mobile-sw.js` and registered with scope
`./`, so it controls every page of the site, not only the Harness UI.

### Worker protocol v1

The service worker is generic: it knows nothing about notifications. It and
the notify browser half agree only on the shapes below. Each package declares
its own copy of these types.

The `data` of every notification shown through the registration:

```ts
interface PwaNotificationData {
  readonly dshPwa: 1
  /** URL to open, relative to the registration scope, when no window of the app is open. */
  readonly openUrl?: string
  /** Opaque JSON owned by the plugin that showed the notification. */
  readonly payload?: JsonValue
}
```

The JSON body of a Web Push message, UTF-8:

```ts
interface PwaPushMessage {
  readonly dshPwa: 1
  readonly title: string
  readonly options: {
    readonly body?: string
    readonly tag?: string
    readonly renotify?: boolean
    readonly requireInteraction?: boolean
    readonly silent?: boolean
    readonly data?: PwaNotificationData
  }
}
```

The worker behaves like this:

- `push` reads `event.data.json()` and shows the notification through
  `self.registration.showNotification`. A body that is not protocol v1 still
  shows a generic notification (title "DeepSeek Harness", no body): Safari and
  Chrome penalize a push that shows nothing at all. The icon and badge are
  `icon-192.png` from the Harness assets.
- `notificationclick` closes the notification, focuses a window of the app
  when one is open (a focused one first, then a visible one), and posts
  `{ type: "dsh-pwa:notificationclick", payload, tag }` to it. Otherwise it
  opens `data.openUrl`, or the scope root.
- `install` skips the waiting phase and `activate` claims open pages, so a
  change of the worker applies at once.
- `fetch` only handles navigation requests: it asks the network and answers
  with the offline page when the Host is down. Every other request is left to
  the browser. The worker caches no app assets: Harness assets are hashed and
  the API is live, so a stale cache would only get in the way.

## Settings

Edit them in **Settings → Mobile**, or in the profile patch under the
`mobile` row. Every change applies immediately in every open page. The page
also says whether the Harness currently uses its phone layout, and at which
width, and the App group shows the app and service worker state.

| Field                | Default   | Meaning                                                                                                                                                                      |
| -------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterKey`           | `newline` | Enter in the composer on a touch screen: `newline` adds a line, `send` keeps the Harness default.                                                                            |
| `swipe`              | `true`    | Edge swipe opens the Harness navigation drawer, swipe left closes it.                                                                                                        |
| `fitKeyboard`        | `true`    | Fit the page to the area the on-screen keyboard leaves visible.                                                                                                              |
| `blockPullToRefresh` | `true`    | Stop pull-to-refresh and overscroll bounce.                                                                                                                                  |
| `autoFocusComposer`  | `false`   | Let a composer button or another Harness action focus the input (and open the keyboard). Off keeps the keyboard closed until you tap the input.                              |
| `serviceWorker`      | `true`    | Register the app's service worker: it shows an offline page when the Host cannot be reached and delivers push notifications (used by the notify plugin). Off unregisters it. |
| `themeColor`         | `true`    | Paint the browser and installed-app title bar in the page background color, following the light or dark theme.                                                               |

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
6. The Host half declares the settings, turns off the schema-generated form,
   and serves `lib/sw.js` at `/dsh-mobile-sw.js` through an exact route of
   `ctx.webServer`. It reads the script once at startup; the route answers
   `GET` and `HEAD` with `text/javascript`, `Cache-Control: no-cache` and
   `Service-Worker-Allowed: /`.
7. The browser half registers the worker with scope `./` while the
   `serviceWorker` setting is on. Turning the setting off finds the
   registration whose active script ends with `/dsh-mobile-sw.js` and
   unregisters it. Plugin teardown (an HMR reload, for example) keeps the
   registration, because unregistering would drop push subscriptions.
8. The install module captures `beforeinstallprompt`, keeps it until the
   button is pressed or the app is installed, and hands it to the browser.
9. The theme color module keeps a `theme-color` meta tag in sync with the
   computed background color of `<body>`. It watches attributes on `<html>`
   and `<body>` and the `prefers-color-scheme` media query, and runs at most
   one update per animation frame.

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
- The service worker stays registered after the plugin is uninstalled or
  disabled, until `serviceWorker` is turned off or the site data is cleared.
  That is on purpose: push subscriptions belong to the registration. Clear the
  site data to remove both.
- The worker has to control the site root, so the app must be served from the
  root path, and HTTPS (or `localhost`) is required; an insecure page cannot
  register a service worker. Safari has no install prompt, and push on iPhone
  and iPad only works after Add to Home Screen (iOS 16.4 and newer).
- The worker caches no app assets. The offline page replaces a navigation the
  Host cannot answer; it does not make the app usable offline.
- Push arrives only with the notify plugin installed and its Host half able to
  reach the push services.
- Buttons and the Settings page are in English, Chinese and Japanese (the
  Japanese copy shows only with a Japanese language pack); the field
  descriptions in the profile schema are English.
