# @1outres/dsh-plugin-notify

Show a desktop notification when the DeepSeek Harness Web UI is in the
background and the Session needs you: a tool call is waiting for approval, the
agent asked a question (or proposed a plan to review), or a turn finished.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-notify
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `notify` row.

## Settings

Open **Settings → Notifications**.

| Field                                     | Default | Meaning                                                                   |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------- |
| Enable notifications                      | on      | Master switch.                                                            |
| Only while this page is in the background | on      | While the window is focused and visible, the prompt is on screen already. |
| Approval prompts                          | on      | A tool call waits for allow or reject.                                    |
| Questions and plan reviews                | on      | The agent asked you something, or proposed a plan.                        |
| Finished turns                            | on      | A turn stopped running while you were looking elsewhere.                  |
| Include request details                   | on      | Adds the tool name, the approval reason, or the question text.            |

The page also shows the browser permission state, an **Allow notifications**
button, and **Send test notification**.

## How it works

1. The browser half subscribes to `uiSession.sessionStatus`, the per-Session map
   the shipped UI already maintains (`running`, `pendingInteraction`,
   `completionUnread`).
2. A new pending interaction, or a Session that stops running, becomes a Web
   Notification: `Approval needed`, `Question waiting`, `Plan review waiting`,
   or `Turn finished`.
3. Notifications are tagged per Session and concern, so a repeated request
   replaces the previous one, and answering the prompt closes it.
4. Clicking a notification focuses the window and opens that Session through
   `uiWorkspace.openSession()`.

The plugin never registers into the approval waterfall: it only reads state the
approval UI already publishes, so it cannot drop, delay, or answer a request.
Notifications are raised by the browser, which means they appear on the machine
showing the page, not on the Host.

## Limits

- No notification while the page is closed: the browser cannot raise one.
- Notification permission is per browser and per origin; each browser asks once.
- The Host does not forward tool arguments to the browser, so the body can show
  the tool name and the approval reason but not the full command.
- Only the highest-precedence pending interaction per Session is visible in the
  status map, so an approval waiting behind a visible question is notified once
  the question is answered.
