# @1outres/dsh-plugin-remote

Works on remote machines over SSH without installing anything on them. The
agent gets tools for one-shot commands, file reads and edits, and interactive
shells (including network devices), and the user approves each new target and
types its passwords in a masked card in the Web UI. The model never sees a
password.

The plugin uses the OpenSSH client that is already on the machine that runs the
Harness, so `~/.ssh/config`, `known_hosts`, the ssh agent, and every other
OpenSSH feature keep working. No helper is installed on the remote host.

```sh
dsh plugin add @1outres/dsh-plugin-remote
```

## What it adds

On the Host half, eleven `remote_*` tools:

| Tool                   | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `remote_target_add`    | Applies for approval of a new SSH target, then opens its connection.             |
| `remote_target_list`   | Shows the targets, their connections, sessions, and which passwords are present. |
| `remote_target_remove` | Removes a target, its sessions, its connection, and its passwords.               |
| `remote_exec`          | Runs one command, similar to the `bash` tool. Supports sudo on Linux.            |
| `remote_read`          | Reads a UTF-8 file on a Linux target, with line windows.                         |
| `remote_write`         | Creates or replaces a file, keeping its mode and owner.                          |
| `remote_edit`          | Replaces literal text with the same rules as the built-in `edit` tool.           |
| `remote_session_open`  | Opens an interactive shell or a network device CLI and keeps it open.            |
| `remote_session_send`  | Types text or a named password field and waits for the output to settle.         |
| `remote_session_read`  | Reads a page of the session output.                                              |
| `remote_session_close` | Closes the session and its remote shell.                                         |

The targets are recorded in the session log, so a resumed or forked session
shows the same list. The target list is not part of the system prompt; the
agent reads it with `remote_target_list`.

## How a target is registered

1. The agent calls `remote_target_add` with the destination, an optional jump
   target, optional `-o` options, and a list of password field names.
2. A card appears in the Web UI. It shows the destination, the jump target, the
   SSH options, and one masked input per password field. Approve it or reject
   it with a reason; the reason reaches the model.
3. While the connection opens, an unknown host key and any password the
   registration did not collect appear in the same card. Accept the host key
   only when you expect the host.
4. A target is recorded only after the connection succeeds.

Passwords live in the Harness Host process only. They are cleared when the
target is removed, when authentication fails, or when the Harness restarts.
They are never written to the session log, the profile, or the credentials
store.

## Config

The settings namespace is `remote`.

| Key                     | Default                                                                            | Meaning                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `sshPath`               | `"ssh"`                                                                            | The ssh command to run.                                    |
| `controlPersistSeconds` | `600`                                                                              | Seconds an unused connection stays open.                   |
| `execTimeoutMs`         | `120000`                                                                           | Default timeout of `remote_exec`.                          |
| `execMaxTimeoutMs`      | `600000`                                                                           | Largest timeout `remote_exec` accepts.                     |
| `maxOutputBytes`        | `30000`                                                                            | Tool output limit; the tail is kept.                       |
| `blockedSshOptions`     | `["ProxyCommand","LocalCommand","PermitLocalCommand","KnownHostsCommand","Match"]` | `-o` names the model may not set.                          |
| `defaultPromptPattern`  | `"[>#$%]\s*$"`                                                                     | Default prompt regex for interactive sessions.             |
| `sessionIdleMs`         | `2000`                                                                             | Silence that ends a wait for interactive output.           |
| `sessionSendTimeoutMs`  | `30000`                                                                            | Default wait of `remote_session_send`.                     |
| `maxSecretRetries`      | `2`                                                                                | Times a refused login or sudo password is asked for again. |

## Security

- A target is approved once, in the registration card. After that, commands
  and file writes on that target do not prompt again. Treat approval as a
  decision to let the agent run anything that user can run on that host.
- The `-o` options that can run a local command are refused. The list is
  `blockedSshOptions`; remove an entry only if you understand the risk.
- Passwords are passed to OpenSSH through an askpass helper and to sudo through
  standard input. They stay in the Host process memory and are never sent to
  the model.
- The agent can name a password field, but it never receives the value. A
  named field with no value opens an input card for the user.
- A sub-agent cannot ask the user for a password or an approval. It gets an
  error instead; the root session must do the registration or the input.
- A changed host key is refused. OpenSSH's normal `known_hosts` checks still
  apply, and an approved `StrictHostKeyChecking` option is followed.

## Limits

- Only the SSH transport exists. The tool names and the transport boundary
  leave room for serial links later.
- The Harness Host must run on Linux or macOS because the askpass helper uses a
  Unix socket.
- Remote file tools expect a Linux target with GNU or BusyBox `base64`,
  `sha256sum`, `stat`, `mktemp`, and `mv`.
- Interactive sessions are line oriented. Full-screen programs such as `top`
  and `vi` are not supported. Disable pagers with `initCommands`, for example
  `["terminal length 0"]`.
- `remote_exec` has no background mode. Use an interactive session for long
  work.
- Interactive sessions and connections live in the Host process. A Host
  restart, session archive, or `workspace/session-stop` closes them.
- Encrypted private keys work through their passphrase field; an ssh agent on
  the Host also works.
- Passwords cannot contain a newline.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
Run the unit tests with `pnpm test`. The Docker integration test is opt-in:

```sh
REMOTE_IT=1 pnpm vitest run packages/dsh-plugin-remote/test/integration
```

It starts two sshd containers: a jump host and a destination that is reachable
only through the jump host.

## License

MIT
