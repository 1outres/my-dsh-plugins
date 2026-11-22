# @1outres/dsh-plugin-restart

Lets a Creator session restart the DeepSeek Harness process and resumes that
session when the process is back. The agent gets one tool, `restart_harness`.

```sh
dsh plugin add @1outres/dsh-plugin-restart
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `restart` row.

## What it does

In a Creator session the model can call `restart_harness` with an optional
`resume_note` that says what to do after the restart. The call only queues the
restart: it takes effect after the calling turn ends, so the model is asked to
end its turn instead of waiting.

The restart is a plain process exit. The plugin hands the launcher's
`appExit` the configured exit code and stops there; a supervisor outside DSH
starts the process again. The plugin never respawns the process itself and runs
no shell command for it.

## Creator only

The tool is offered only when both are true:

- the agent is the root agent of its session, so a sub-agent never sees it;
- the session uses one of the Creator presets in `presets`.

`cordis` is the shipped Creator preset, and `creator-ptc` is this repository's
copy of it.

## One restart at a time

Before the request is accepted, and again when the calling session goes idle,
the plugin looks at every live session. A running session blocks the restart,
including a sub-agent of the calling session. The message names each running
session, with its title when the title service has one. Background jobs do not
block a restart.

A session that starts running while the restart waits cancels it: the plugin
goes back to idle and sends the caller a follow-up that says which sessions
were running. If the caller is closed meanwhile, the restart is cancelled
silently and only logged.

## Resume

The call only queues the restart. Once the calling session has gone idle, and
the second check over the live sessions still passes, the plugin stores the
session id, the note, and the request time in the `restart_resume` storage
domain, and only then asks for the exit.

At the next startup, once the Harness reports readiness and the Web session
controller is there, the plugin:

1. deletes the stored record, before anything else, so a crash during the
   resume cannot loop the same message;
2. drops it when it is older than `resumeWithinMinutes`, and logs that;
3. resolves the session with the session controller;
4. sends one user message with the `restart` source. It says when the restart
   finished, repeats the `resume_note` when there was one, and asks the agent to
   continue the task.

Only the session that asked is resumed. Nothing else is replayed.

## Supervisor

DSH must run under a supervisor that starts it again after a non-zero exit. For
a systemd service:

```ini
[Service]
ExecStart = dsh web
Restart = on-failure
RestartSec = 5
```

The exit code is non-zero on purpose: `Restart = on-failure` restarts the
service only then. `exitCode` defaults to 75, the conventional "temporary
failure, try again" code, so a restart looks different from a crash in the logs.
A `Restart = always` unit works too.

The graceful shutdown may hang on a handle that stays open. After `appExit` the
launcher only sets the exit code, so the plugin also arms a watchdog:
`forceExitAfterMs` after the exit request it calls `process.exit` itself. The
watchdog timer belongs to the process, not to the plugin context, because
shutdown disposes the context and clears its timers.

## Config

The settings namespace is `restart`.

| Key                   | Default                     | Meaning                                                                                 |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `presets`             | `["cordis", "creator-ptc"]` | Agent preset ids that count as Creator mode.                                            |
| `exitCode`            | `75`                        | Exit code that asks the supervisor to start DeepSeek Harness again. 1 to 255.           |
| `resumeWithinMinutes` | `10`                        | A stored resume request older than this many minutes is dropped and logged.             |
| `forceExitAfterMs`    | `15000`                     | Milliseconds after the exit request before the process is ended even if shutdown hangs. |

```yaml
- id: restart
  config:
    presets: ["cordis", "creator-ptc"]
    exitCode: 75
```

## Limits

- With no `appExit` from the launcher the tool is never offered, and the plugin
  logs a warning. Nothing else ends the process in its place.
- Resuming needs the Web session controller. A startup without it keeps the
  record; a later startup that has it resumes the session while the record is
  still young enough.
- A launcher that provides no readiness signal lets the resume start as soon as
  the session controller exists.
- The resume message is one user message. It does not restore files, jobs, or
  anything else that was in flight.
- There is no browser half, so the plugin adds no Web UI of its own, and no
  settings page beyond this row.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
Its unit tests use fakes and need no running Harness or supervisor.

## License

MIT
