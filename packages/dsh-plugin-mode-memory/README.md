# @1outres/dsh-plugin-mode-memory

Remembers the agent preset ("mode") each project last used and opens that
project's new blank sessions with it. Without this plugin every new session
starts with the global default preset, and reusing an existing blank session
switches it back to that default.

```sh
dsh plugin add @1outres/dsh-plugin-mode-memory
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `mode-memory` row.

## When it remembers

A choice is saved when a session commits a different preset outside a
`session.create` call: you pick one in the new-session chip, or Settings syncs
one. The plugin listens for `agent-preset/selected` and stores the preset under
the session's `cwd`, so a project keeps one preset however many sessions it
opens.

The Host switches a reused blank session to the global default inside
`session.create`. That reset is not a choice and is never remembered, so a
project with no memory keeps following the global default, including later
changes to it.

These selections are ignored:

- an unknown session;
- a subagent session;
- a session without a `cwd`;
- any selection made inside a `session.create` call.

When a request already names a preset, the plugin passes it through unchanged
and remembers the preset that actually ran afterwards. An explicit choice, such
as a Creator entry or reopening a blank session, is never overridden.

## When it applies

When a workspace is opened or **New session** is pressed, the Web UI calls
`sessionController.create`. If that request names no preset, the plugin looks
up the project's remembered preset and adds it. The project is the workspace
path when the request names a workspace, otherwise the request `cwd`.

A remembered preset is used only while the preset roster still lists it and
does not mark it broken. A request without a project path, or with an unknown
workspace id, is left alone.

## Forgotten presets

When the remembered preset is no longer listed, or is listed as broken, the
plugin forgets it and lets the session start with the global default. A
renamed or deleted preset therefore never blocks a new session. If the roster
cannot be read, the plugin logs a warning and also leaves the session to the
global default; the memory is kept and tried again next time.

## Storage

The memory lives in the durable storage domain `mode_memory`, table
`projects`. The key is the normalized project path: trailing slashes are
removed, so `/work/repo` and `/work/repo/` are the same project. The value is
the preset id and the time of the choice.

## Limits

- The plugin wraps the internal `sessionController.create` method through its
  cordis Proxy. A DSH upgrade can move or rename that method. The plugin then
  fails to start with a clear error instead of misbehaving.
- It only affects sessions created through the Web UI's `session.create`.
  Sessions created by other means keep their own preset handling.
- The project is matched by path spelling. The same directory reached through a
  symlink or a different relative spelling is a different project.
- There is no browser half and no settings; the plugin adds no Web UI of its
  own.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
Its unit tests use fakes and need no running Harness.

## License

MIT
