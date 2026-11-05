# @1outres/dsh-plugin-edit-message

Edit a message you already sent in the DeepSeek Harness Web UI, the way chat
apps do: click **Edit** beside Copy, change the text, and send. The
conversation restarts from just before that message with the edited text.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-edit-message
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `edit-message` row.

## Editing a message

Hover a message you sent and click the pencil next to Copy. The bubble turns
into an editor with the original text.

| Key                     | Action                  |
| ----------------------- | ----------------------- |
| `Ctrl+Enter` / `⌘Enter` | Send the edited message |
| `Esc`                   | Cancel; nothing changes |
| `Enter`                 | New line                |

`Enter` does not send, whatever the composer setting says: sending replaces
the conversation, so it needs the deliberate shortcut or the Send button.
Sending unchanged text is allowed and regenerates the answer from that point.

The button is shown on the prompt that opens each turn. It is not shown on
steering messages sent while a turn was running, nor in subagent sessions. It
is dimmed, with the reason in its tooltip, while the session is running, when
the message has attached files, or when this browser may not fork the session.

## What sending does

DSH session logs are append-only, so an edit cannot shorten the current
session. Instead, Send:

1. Forks the session just before the edited message: through the end of the
   previous turn and the events recorded after it (changed-file summaries,
   titles, model choices, commands). Editing the first message keeps only the
   session's setup.
2. Removes any queued prompt the fork inherited. A prompt queued while the
   previous turn was running is logged before that turn ends, and would
   otherwise run ahead of the edited one.
3. Keeps the original title on the fork when a later message is edited. When
   the first message is edited, the title is generated again for the new
   topic.
4. Sends the edited text, with the original message's images, in the fork.
5. Only after the fork accepts the prompt: places the fork where the original
   sits in its workspace, opens it, and archives the original.

If any step fails, the original session is not touched, an unused fork is
archived, and the editor stays open with the error and your text.

The archived original stays available under the sidebar's archived filter and
can be unarchived. The new session has a new id and URL.

## Limits

- **Files are not reverted.** Only the conversation goes back; files the agent
  changed after that point stay changed.
- Messages with attached files cannot be edited: the browser cannot read a
  file attachment back to send it again. Images are sent again; v1 edits the
  text only and cannot add or remove images.
- Each edit leaves the previous version in the archive. DSH offers no way to
  delete a session.
- Renaming the fork pins its title, as a manual rename does, so it is no
  longer generated automatically.
- The Edit button is added to the shipped message bubble, which offers no
  slot for message actions. The plugin wraps the shipped `user` renderer of
  `conversation.chat.node` and appends its button to that bubble's action
  row. If a Harness update changes that row, the button is not shown; if the
  wrapper throws, the slot runtime retires it and the shipped bubble returns.
- English only.

## How it works

The browser half registers a `user` renderer in `conversation.chat.node` at
priority `-100`, above the shipped one at `0`, and renders the shipped
renderer inside it unchanged. Its Edit button and editor use copied host
styles that share only theme tokens. The edit runs through the Session and
Workspace services the Web UI already uses (`ctx.sessions`,
`ctx.uiWorkspace`, `ctx.workspaces`). The host half has no behavior and no
settings.
