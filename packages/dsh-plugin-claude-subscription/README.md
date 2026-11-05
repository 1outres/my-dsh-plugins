# @1outres/dsh-plugin-claude-subscription

Use your own Claude subscription as an LLM provider in DeepSeek Harness (DSH).

This plugin is unofficial. It is not affiliated with or endorsed by Anthropic.

DSH keeps its agent loop, tools, approvals and compaction. For each model call,
the plugin runs the official `claude` CLI once, in `-p` stream-json mode, behind a
small relay on the loopback address. The relay lets exactly one request reach
Anthropic and refuses every other request from that process. The CLI's own tools
are off, so the model can only call the tools DSH offers, and DSH runs them.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-claude-subscription
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `claude-subscription` row.

## Requirements

- DSH 0.2.1-rc.5 or newer in the 0.2 line. Windows is not
  supported.
- The official Claude Code CLI, installed:

  ```sh
  npm install -g @anthropic-ai/claude-code
  ```

- A login, made as the same user that DSH runs as:

  ```sh
  claude auth login
  ```

The login belongs to the CLI. The plugin never opens or copies credential files,
has no login flow of its own, and asks for no API key. When the CLI is logged out,
a call fails with a message that tells you to run `claude auth login`.

The plugin refuses to run when the environment of DSH sends the CLI to another
backend. It fails with `CONFLICTING_ENVIRONMENT` and names the variables, never
their values. These are `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`,
`CLAUDE_CODE_USE_VERTEX` and `CLAUDE_CODE_USE_FOUNDRY`.

## Settings

The plugin has no settings page. Set these fields in your profile's
`cordis.patch.yml`:

```yaml
- id: claude-subscription
  config:
    claudeConfigDir: ~/.claude-work
```

DSH reads the edit when it recomposes the profile. Without its HMR plugin, restart
DSH instead.

| Field                    | Default  | Meaning                                                                                                                                        |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`                | `claude` | Name found through `PATH`, or an absolute path.                                                                                                |
| `claudeConfigDir`        | empty    | Config directory of a separate Claude login. Empty uses `CLAUDE_CONFIG_DIR` from the environment, then the CLI's own default.                  |
| `claudeCodeTelemetry`    | on       | Lets the CLI send its telemetry and fetch feature flags. The flags unlock models in its picker, so turning this off can shrink the model list. |
| `readIdleTimeoutSeconds` | `1800`   | Seconds of silence from the CLI before a call fails with `TIMEOUT`. From 1 to 2147483.                                                         |

Whatever the settings say, the CLI is started with `DISABLE_AUTOUPDATER`,
`DISABLE_FEEDBACK_COMMAND` and `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`.

The relay reads `https_proxy`, `http_proxy` and `NO_PROXY` from the environment of
DSH. Only an `http://` proxy that supports `CONNECT` works. Any other proxy URL
fails the call, and the plugin does not connect directly instead. Set
`CLAUDE_CODE_GZIP_REQUEST_BODIES=0` to send request bodies uncompressed.

## Models

The model list comes from the CLI's answer about your account. Pinned routes the
answer leaves out are added after it, except models Anthropic grants per
organization. If the CLI cannot answer, for example when it is logged out, no
model is listed, and the message appears on the provider's row under
**Settings → Models**. The next look at the list asks the CLI again.

A pinned 1M model is sent with `[1m]`. An id the plugin does not know is sent as it
is and reports a 200K window. An unknown id that ends in `[1m]` reports no window.

## What the model sees

The CLI adds its own text to every request. Besides the DSH system prompt and
history, the request holds:

- A first system block with the CLI's version and the caller name, for example
  `x-anthropic-billing-header: cc_version=2.1.317.173; cc_entrypoint=deepseek-harness;`.
- A second system block: `You are a Claude agent, built on Anthropic's Claude Agent SDK.`
- A `# Environment` block, sent as a `system` message after the first user turn.
  It lists the working directory, whether it is a git repository, the platform, the
  shell and the OS version. It adds a note on downloaded files, the model's name
  and id, its knowledge cutoff and today's date.

The working directory in that block is a private directory the plugin keeps for the
CLI, not your workspace. The DSH system prompt names the real one.

A user turn that ends in text starting with `/` reaches the model with one leading
space. Without the space the CLI reads the text as a slash command, even with
`--disable-slash-commands`, and the call fails.

Text in this section was read from a request by Claude Code 2.1.317. Another CLI
version can differ.

## Known limits

- Each model call starts a new `claude` process, so a call has more start-up time
  than a direct API call.
- The plugin relies on how the CLI behaves today: its replay of history, its
  extra-body setting, and its stream-json output. A CLI update can change them.
- Calls count against your subscription limits. Your account decides whether a model
  uses usage credits. Some rows in the model list say so, and the plugin does not
  block them.
- DSH shows token counts for a call, but the plugin reports no cost.
- A reply cut off by the output limit runs no tool call, and DSH sees `max-tokens`.
- A refusal ends the call with `CONTENT_FILTER` and the reason the service gave. A
  tool call in a refused reply never runs.
- A reply that ends normally with no text and no tool call, even one with thinking,
  fails with `EMPTY_RESPONSE`, which DSH retries. A reply cut off by the output limit
  reports `max-tokens` instead.
- A request whose retained images pass 20 MiB as base64 fails with `IMAGE_OFFLOAD_REQUIRED`.
  DSH then offloads the oldest images and retries. A dropped image keeps a text note that
  names its read-only path when DSH has one.
- `temperature` is checked and then dropped. It never reaches the model.
- DSH removes variables with `TOKEN` in their names before it starts a child process,
  so `CLAUDE_CODE_OAUTH_TOKEN` in the environment of DSH does not reach the CLI. Log in
  with `claude auth login` instead.
- The relay trusts Node's bundled certificate list and `NODE_EXTRA_CA_CERTS`. A
  TLS-inspecting proxy whose certificate is only in `SSL_CERT_FILE` fails the call.
- Every call declares the full active tool list, so adding or removing a tool during a
  conversation rewrites the prompt cache from that point.
- Signed thinking is replayed only for a message that was not edited, was made by the
  same model that the request names, and holds text or a tool call besides its thinking.
  Any other message, such as an edited one or one from before a model switch, is sent
  again as plain text and tool calls.

## Attribution

Ported from the `claude-subscription-directsdk` plugin of
[NousResearch/hermes-official-plugins](https://github.com/NousResearch/hermes-official-plugins),
at commit `83f0a89`, MIT licensed. See `LICENSE`.
