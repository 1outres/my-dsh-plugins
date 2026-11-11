# @1outres/dsh-plugin-remote

Works on remote machines over SSH, and on network-device consoles through a
small serial agent, without installing anything on an SSH host. The agent gets
tools for one-shot commands, file reads and edits, and interactive shells
(including network devices), and the user approves each new target and types
its passwords in a masked card in the Web UI. The model never sees a password.

For SSH the plugin uses the OpenSSH client that is already on the machine that
runs the Harness, so `~/.ssh/config`, `known_hosts`, the ssh agent, and every
other OpenSSH feature keep working. No helper is installed on the remote host.

For serial consoles, `dsh-serial-agent` runs on a client PC (macOS or
Linux/NixOS) that has the console cable plugged in. It dials out to the Harness
over WebSocket, so no inbound port is opened on the client PC.

```sh
dsh plugin add @1outres/dsh-plugin-remote
```

## What it adds

On the Host half, thirteen `remote_*` tools:

| Tool                   | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `remote_target_add`    | Applies for approval of a new SSH or serial target, then opens its connection.   |
| `remote_target_list`   | Shows the targets, their connections, sessions, and which passwords are present. |
| `remote_target_remove` | Removes a target, its sessions, its connection, and its passwords.               |
| `remote_exec`          | Runs one command, similar to the `bash` tool. Supports sudo on Linux.            |
| `remote_read`          | Reads a UTF-8 file on a Linux target, with line windows.                         |
| `remote_write`         | Creates or replaces a file, keeping its mode and owner.                          |
| `remote_edit`          | Replaces literal text with the same rules as the built-in `edit` tool.           |
| `remote_session_open`  | Opens an interactive shell or a network device CLI and keeps it open.            |
| `remote_session_send`  | Types text or a named password field and waits for the output to settle.         |
| `remote_session_read`  | Reads a page of the session output.                                              |
| `remote_session_break` | Sends a serial BREAK, for example to enter ROMMON or a boot loader.              |
| `remote_session_close` | Closes the session and its remote shell.                                         |
| `remote_serial_agents` | Lists the authorized serial agents and the ports each one offers.                |

The targets are recorded in the session log, so a resumed or forked session
shows the same list. The target list is not part of the system prompt; the
agent reads it with `remote_target_list`.

## How a target is registered

1. The agent calls `remote_target_add` with the destination, an optional jump
   target, optional `-o` options, and a list of password field names. For a
   serial target it names an authorized agent and a device path instead.
2. A card appears in the Web UI. It shows the destination or the serial agent
   and device, the SSH options or the agent fingerprint, and one masked input
   per password field. Approve it or reject it with a reason; the reason reaches
   the model.
3. While the connection opens, an unknown SSH host key and any password the
   registration did not collect appear in the same card. Accept the host key
   only when you expect the host.
4. A target is recorded only after the connection succeeds.

Passwords live in the Harness Host process only. They are cleared when the
target is removed, when authentication fails, or when the Harness restarts.
They are never written to the session log, the profile, or the credentials
store.

## Serial consoles

A serial target is a console cable on a client PC, reached through
`dsh-serial-agent`. The agent is a small Go daemon with no inbound listener: it
opens a WebSocket to `<Harness URL>/remote-serial/agent` and authenticates with
an Ed25519 key. The same WebSocket carries requests and console output.

1. Install `dsh-serial-agent` from this repository's flake; see
   [the serial agent](../../serial-agent/README.md). Its config lists the device
   paths it may open, the Harness gateway URL, its private key, and a buffer
   size. The `allow` list is the agent-side limit on which devices the Harness
   can reach.
2. Run `dsh-serial-agent pubkey`. It prints the public key, the fingerprint,
   and a JSON `config:` line. Add that entry to `serialAgents`, either in the
   plugin settings of the Web UI or in the profile patch:

   ```yaml
   - id: remote
     config:
       serialAgents:
         - {"name":"lab-mac","publicKey":"<base64 public key>"}
   ```

   The key is accepted only after the plugin reloads. An agent that is not in
   this list is refused with close code 4403.
3. Ask the agent to list its ports with `remote_serial_agents`. It shows the
   fingerprint, whether the agent is online, and the device paths.
4. Register a target with `remote_target_add`, `transport: "serial"`,
   `agent: "lab-mac"`, `device: "/dev/ttyUSB0"`, and the line settings. The card
   shows the agent fingerprint; compare it with `dsh-serial-agent pubkey`
   before approving.
5. Open a session and press Enter once: many consoles print their prompt only
   after an empty line. `remote_session_send` with an empty `text` does that.

Ports outlive the Harness. When the WebSocket drops, the agent keeps the port
open and keeps reading into its ring buffer, so console output produced while
the Harness restarts is still there. A session that attaches to an already open
port replays the last `serialReplayBytes` bytes and marks any bytes that were
lost. Ports with no subscriber close after the agent's `orphanTimeout`.

A session can send a serial BREAK with `remote_session_break`; it is often the
way into ROMMON or a boot loader. SSH sessions do not support it.

## Config

The settings namespace is `remote`.

| Key                      | Default                                                                            | Meaning                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `sshPath`                | `"ssh"`                                                                            | The ssh command to run.                                               |
| `controlPersistSeconds`  | `600`                                                                              | Seconds an unused connection stays open.                              |
| `execTimeoutMs`          | `120000`                                                                           | Default timeout of `remote_exec`.                                     |
| `execMaxTimeoutMs`       | `600000`                                                                           | Largest timeout `remote_exec` accepts.                                |
| `maxOutputBytes`         | `30000`                                                                            | Tool output limit; the tail is kept.                                  |
| `blockedSshOptions`      | `["ProxyCommand","LocalCommand","PermitLocalCommand","KnownHostsCommand","Match"]` | `-o` names the model may not set.                                     |
| `defaultPromptPattern`   | `"[>#$%]\s*$"`                                                                     | Default prompt regex for interactive sessions.                        |
| `sessionIdleMs`          | `2000`                                                                             | Silence that ends a wait for interactive output.                      |
| `sessionSendTimeoutMs`   | `30000`                                                                            | Default wait of `remote_session_send`.                                |
| `maxSecretRetries`       | `2`                                                                                | Times a refused login or sudo password is asked for again.            |
| `serialAgents`           | `[]`                                                                               | Authorized agent keys: `{ name, publicKey }` entries.                 |
| `serialGatewayPath`      | `"/remote-serial/agent"`                                                           | Path where `dsh-serial-agent` opens its WebSocket.                    |
| `serialRequestTimeoutMs` | `10000`                                                                            | Milliseconds before a request to an agent fails.                      |
| `serialReplayBytes`      | `4096`                                                                             | Earlier console output shown when a session attaches to an open port. |

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
- Only Ed25519 keys listed in `serialAgents` may connect. The agent proves the
  key with a signature over a fresh nonce, and the target stores the key
  fingerprint it was registered with. A changed agent key is refused.
- An upgrade request with an `Origin` header is answered with HTTP 403, so a
  web page cannot open an agent socket. The gateway also refuses binary frames
  and frames larger than 1 MiB.
- The agent's own `allow` patterns decide which devices it may open. Give the
  agent the narrowest list that works, and keep its private key on that
  machine.
- The gateway is part of the Harness Web server, so use the HTTPS Harness URL
  (`wss://`) and a reverse proxy that terminates TLS. Anyone who can reach the
  gateway still needs an authorized private key.

## Limits

- Serial targets support only interactive sessions and BREAK. One-shot
  commands, sudo, and the file tools need the SSH transport.
- One root session may hold a serial port at a time. Another session that asks
  for the same agent and device gets a clear error.
- Serial sessions are line oriented, like SSH sessions. Full-screen programs
  such as `top` and `vi` are not supported. Disable pagers with
  `initCommands`, for example `["terminal length 0"]`.
- The Harness Host must run on Linux or macOS because the SSH askpass helper
  uses a Unix socket. The serial gateway itself is plain WebSocket.
- Remote file tools expect a Linux target with GNU or BusyBox `base64`,
  `sha256sum`, `stat`, `mktemp`, and `mv`.
- `remote_exec` has no background mode. Use an interactive session for long
  work.
- Interactive sessions and SSH connections live in the Host process. A Host
  restart, session archive, or `workspace/session-stop` closes them. A serial
  port stays open in the agent and keeps its buffer; a new Harness process can
  attach again.
- The agent reconnects with exponential backoff. While it is offline, writes
  fail with a clear error, and the session resumes when the agent returns.
- A reverse proxy in front of the Harness must pass WebSocket upgrades on the
  gateway path. A proxy that adds its own login, such as nginx
  `auth_request`, must leave the exact gateway path out of that login: the
  agent sends no browser cookie, and the gateway checks the agent key itself.
- Encrypted private keys work through their passphrase field; an ssh agent on
  the Host also works.
- Passwords cannot contain a newline.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
Run the unit tests with `pnpm test`. The integration tests are opt-in:

```sh
REMOTE_IT=1 pnpm vitest run packages/dsh-plugin-remote/test/integration/remote.test.ts
SERIAL_IT=1 pnpm vitest run packages/dsh-plugin-remote/test/integration/serial.test.ts
```

The SSH test starts two sshd containers: a jump host and a destination that is
reachable only through the jump host. The serial test builds the Go agent,
starts it against a real gateway, and connects it to a fake network device over
a pair of pseudo terminals made by `socat`. Both need a dev shell:

```sh
nix develop . -c bash -c 'SERIAL_IT=1 pnpm vitest run packages/dsh-plugin-remote/test/integration/serial.test.ts'
```

## License

MIT
