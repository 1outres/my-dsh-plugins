# @1outres/dsh-plugin-notify

Show a notification when the DeepSeek Harness Web UI is in the background or
closed and the Session needs you: a tool call is waiting for approval, the
agent asked a question (or proposed a plan to review), or a turn finished.

The plugin has two delivery paths on one device:

- the page raises a desktop notification while it is open, and
- the Host sends a Web Push message that the browser shows even while the page
  is closed.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-notify
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `notify` row.

Web Push also needs the PWA features of
[`@1outres/dsh-plugin-mobile`](../dsh-plugin-mobile): its service worker
receives the push and shows the notification. Keep that plugin's
**service worker** setting on.

## Settings

Open **Settings → Notifications**.

| Field                                     | Default | Meaning                                                                   |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------- |
| Enable notifications                      | on      | Master switch.                                                            |
| Only while this page is in the background | on      | While the window is focused and visible, the prompt is already on screen. |
| Send push notifications                   | on      | The Host may push to devices that turned push on.                         |
| Approval prompts                          | on      | A tool call waits for allow or reject.                                    |
| Questions and plan reviews                | on      | The agent asked you something, or proposed a plan.                        |
| Finished turns                            | on      | A turn stopped running while you were looking elsewhere.                  |
| Include request details                   | on      | Adds the tool name, the approval reason, or the question text.            |

The page also shows the browser permission state, an **Allow notifications**
button, and **Send test notification** for the page path. On an iPhone or iPad
tab that is not on the Home Screen, the permission row shows the Home Screen
step instead of an unsupported message.

**Push notifications on this device** shows the push state and offers
**Turn on push on this device**, **Turn off push on this device**, and
**Send test push**. The state is one of: on, off, this browser does not support
push, no service worker controls the page, the app must be added to the Home
Screen (iPhone and iPad), the browser blocked notifications, or an error.

### Host config

| Field          | Default                                     | Meaning                                                                                   |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `push`         | on                                          | Same switch as the Settings row; the Host may send pushes.                                |
| `vapidSubject` | `https://github.com/1outres/my-dsh-plugins` | VAPID `sub` claim: a `mailto:` or `https:` URL that push services may use to contact you. |

`vapidSubject` is not shown in Settings. Change it in the plugin config; the
Host half reloads and keeps the stored VAPID keys.

## How it works

1. The browser half subscribes to `uiSession.sessionStatus`, the per-Session
   map the shipped UI already maintains (`running`, `pendingInteraction`,
   `completionUnread`).
2. A new pending interaction, or a Session that stops running, becomes a
   notification: `Approval needed`, `Question waiting`,
   `Plan review waiting`, or `Turn finished`.
3. Notifications are tagged per Session and concern, so a repeated request
   replaces the previous one, and answering the prompt closes it.
4. Clicking a notification focuses the window and opens that Session through
   `uiWorkspace.openSession()`.

For push, the Host does the same diff:

1. A Host watcher mirrors `api-session/status`, and records
   `approval/request` and `user-questions/request` while they are pending.
   Both request events are **pass-through waterfall listeners**: the watcher
   records the request, calls `next()`, and returns its result unchanged. It
   never answers, replaces, or delays a request.
2. The dispatcher runs the same pure `diffStatus` logic as the page, applies
   the settings, and encrypts one message per subscription with RFC 8291
   (`aes128gcm`) and signs the request with VAPID (RFC 8292).
3. A pending interaction is pushed only after 1.5 seconds and only if it is
   still pending. Automatic answerers (permission presets, automatic plan
   review) settle most requests immediately, and a push for an answered request
   is noise. A finished turn is pushed at once.
4. Each subscription reports presence: visible and focused. With **Only while
   this page is in the background** on, the Host skips a device whose page is
   watching. Presence expires after 75 seconds, so a closed page stops blocking
   pushes.
5. While push is on for this device, the page is not a second notification
   source: the Host is the single source for that device, and the page only
   closes notifications whose interaction is answered.
6. On start, and when the push setting changes, the page re-registers its
   existing subscription with the Host. This heals a Host that lost its
   storage. Turning the push setting off keeps the subscription in the
   browser; the Host simply stops sending.

The payload is the DSH PWA worker protocol v1. The worker shows the
notification, and a click either focuses an open window and posts
`{ type: "dsh-pwa:notificationclick", payload: { sessionId } }`, or opens
`./?dsh-notify-session=<id>` when no window is open. The page opens that
Session and removes the query parameter.

## Limits

- **Requests are observed, not intercepted.** The watcher is a waterfall
  listener that always delegates with `next()`. It cannot drop, answer, or
  replace an approval or a question; it only reads the pending state while the
  real answerer works.
- **The Host needs internet access to reach push services.** A push that cannot
  leave the Host is logged (origin only, no endpoint or key), and a subscription
  the service reports gone is deleted.
- **VAPID keys live in the Host profile storage** (the `notify-push` storage
  domain). Removing that data makes every device subscribe again. Keys never
  leave the Host.
- **Tool arguments are still not included.** The body can show the tool name
  and the approval reason, but not the full command.
- **iPhone and iPad need the app on the Home Screen.** Safari only delivers
  push to an installed web app. Android Chrome and desktop browsers work in a
  normal tab.
- **Push needs the Mobile plugin's service worker.** The page registers it with
  scope `/`; without a controlling worker the push state says so.
- **The Host cannot close a notification already shown.** Answering the prompt
  closes it on the page that is open; a device with no open page keeps the
  notification until the user taps or dismisses it.
- **One interaction per Session is shown.** The watcher publishes the most
  recently opened pending interaction, matching the one interaction per
  Session the browser UI shows. An older request behind it is pushed once it
  becomes the top one.
- **Presence is in Host memory.** A Host restart forgets presence, so the next
  push may arrive on a device that is looking at the page until that page
  reports again (at most 30 seconds).
