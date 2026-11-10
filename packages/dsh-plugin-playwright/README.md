# @1outres/dsh-plugin-playwright

Gives every top-level DeepSeek Harness session its own Playwright browser
context and the browser tools from
[Playwright MCP](https://github.com/microsoft/playwright-mcp). Sessions do not
share tabs, cookies, or storage, and one session never waits for another
session's browser work.

```sh
dsh plugin add @1outres/dsh-plugin-playwright
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `playwright` row.

## What it adds

Twenty-three `browser_*` tools, taken from the upstream Playwright MCP server:

| Group               | Tools                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation          | `browser_navigate`, `browser_navigate_back`, `browser_wait_for`                                                                                                            |
| Snapshot            | `browser_snapshot`, `browser_find`, `browser_take_screenshot`, `browser_console_messages`                                                                                  |
| Input               | `browser_click`, `browser_type`, `browser_fill_form`, `browser_press_key`, `browser_select_option`, `browser_hover`, `browser_drag`, `browser_file_upload`, `browser_drop` |
| Tabs and view       | `browser_tabs`, `browser_resize`, `browser_emulate_media`                                                                                                                  |
| Dialogs and scripts | `browser_handle_dialog`, `browser_evaluate`                                                                                                                                |
| Network             | `browser_network_requests`, `browser_network_request`                                                                                                                      |

Tool names, descriptions, and parameter schemas are the upstream ones. The
plugin lists the upstream tools once at startup through a probe MCP connection
that does not launch a browser. Upstream order is kept and the plugin fails to
start if the server lists a name twice.

## Isolation

- One Chromium process is shared because starting a browser is the expensive
  part. Each root session gets its own `BrowserContext`, so tabs, cookies, and
  storage stay apart. Sessions can work at the same time; Playwright multiplexes
  their calls over one process.
- A context is created on the first browser tool call of its root session, not
  when the session starts. Concurrent first calls for one session wait for the
  same creation, so two contexts are never created by accident.
- A sub-agent uses the browser of its root session. The session tree is walked
  from the calling agent up to the top-level agent.
- A context that crashes or closes is dropped. Its next call creates a new
  context. Other sessions keep their own contexts and are not touched.
- If the shared browser disconnects, the next call launches a new browser. That
  is recovery, not a fallback: no browser other than `executablePath` is ever
  guessed.
- The context and the MCP connection are disposed with the session on
  `session/disposed` and `workspace/session-stop`. Unloading the plugin closes
  every context and the browser.

Each session also gets a private temporary output directory. Upstream tools that
write generated files without a name go there, and the directory is removed with
the session.

## Result handling

The plugin talks to the upstream server in process, with an MCP `Client` over
an in-memory transport. Results are adapted with the public
`createMcpToolDefinition` helper from `@deepseek-ai/dsh-mcp-client`:

- text blocks become model-facing text, capped by `maxOutputBytes` with a
  `[output truncated]` marker;
- MCP image blocks become durable image attachments when the active model
  accepts image input, and a short diagnostic text otherwise;
- an MCP result with `isError` becomes a failed tool call with the upstream
  message.

## Excluded tools

Two tools in the current upstream list are not registered, and the plugin
also refuses `browser_install` if a later upstream version adds it:

| Tool                      | Why                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `browser_close`           | Closes the session's context and tears down its backend, so it would fight the plugin's own lifecycle.                      |
| `browser_run_code_unsafe` | Runs arbitrary Playwright code and can close the shared browser or other contexts.                                          |
| `browser_install`         | Installs a browser into the Harness host instead of using the configured `executablePath`. Version 0.0.85 does not list it. |

Only the upstream core capability is enabled. Config, storage, PDF, testing,
vision, and devtools tools are not exposed.

## Config

The settings namespace is `playwright`.

| Key                 | Default  | Meaning                                                                                              |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `executablePath`    | `""`     | Path to the Chromium or Chrome binary. Required; an empty value stops the plugin with a clear error. |
| `headless`          | `true`   | Run the browser without a window.                                                                    |
| `launchArgs`        | `[]`     | Extra arguments passed to the browser process.                                                       |
| `maxOutputBytes`    | `30000`  | Bytes of text kept in one tool result. Images do not count.                                          |
| `toolCallTimeoutMs` | `120000` | Milliseconds before one browser tool call is stopped.                                                |

NixOS cannot run the browsers that Playwright downloads. Point
`executablePath` at a Chromium or Chrome binary from a package, for example:

```yaml
- id: playwright
  config:
    executablePath: /run/current-system/sw/bin/chromium
```

The browser must be able to start without a sandbox when it runs as the Harness
user. Playwright passes `--no-sandbox` by default; add launch arguments only
when your browser needs them.

## Limits

- One browser process is shared, so a browser-level crash affects every session
  at once. Their contexts are recreated on the next call.
- A session's context is not persisted. Cookies and storage live in memory and
  disappear when the session is archived, stopped, or the Host restarts.
- The upstream server has no per-session tool filtering beyond the plugin's
  exclusion list.
- `browser_tabs` can close a tab, but the plugin does not expose closing the
  whole session context.
- The `isolatedContext` option of `browser_tabs` is not supported. The plugin
  supplies the session context, so the upstream server cannot create another
  one.
- Some upstream tools read or write host files, for example `browser_file_upload`
  and the `filename` options for snapshots, console messages, network details,
  and evaluated results. They run as the Harness user and are not covered by the
  DSH file policy.
- The plugin has no browser half, so it adds no Web UI of its own.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
The unit tests use fakes and need no browser. The integration test is opt-in and
needs a Chromium binary:

```sh
PLAYWRIGHT_IT_CHROMIUM=/path/to/chromium pnpm vitest run packages/dsh-plugin-playwright/test/integration
```

It starts a local HTTP server, drives two sessions through the same tool code
path at the same time, and checks that their tabs and cookies stay apart before
closing the browser.

## License

MIT
