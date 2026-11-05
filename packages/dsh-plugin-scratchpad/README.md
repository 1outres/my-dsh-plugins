# @1outres/dsh-plugin-scratchpad

A place for work that belongs to no repository: one-off scripts, small
experiments, research, writing. **New scratch** creates a new empty directory,
registers it as its own workspace, and opens a session there. Archive the
session when you are done and the directory is moved out of the way.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-scratchpad
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `scratchpad` row.

## Starting a scratch

Any of these opens a scratch:

- **New scratch** at the foot of the sidebar, beside Settings.
- `/scratch` in the composer of any session.
- **New scratch** in the New Session row of a blank session in the
  `scratchpad` root workspace (see below).

A new scratch is `~/.dsh/scratchpad/YYYY-MM-DD-HHmmss/`, named after the local
time of the browser and suffixed `-2`, `-3`, ... only on a collision. The
directory starts empty: no `git init`, no files. The workspace is titled after
the directory; renaming the workspace or the session never renames the
directory.

When the newest scratch is still unused (nothing was sent in any of its
sessions and none is archived), the button opens it again instead of creating
another empty directory.

Each scratch is its own workspace, so the session's file policy covers that
directory only, and the Files panel, terminal and **New Session** in the
workspace work as anywhere else.

### The root workspace

Creating a scratch also registers the root, `~/.dsh/scratchpad`, as a
workspace. With **View options → Group by → Workspace Tree** in the sidebar's
Workspaces header, every scratch nests under it, so the scratches read as one
`scratchpad` project. The grouping choice is saved per browser and defaults to
flat.

**New Session** in the root workspace opens a session in the root itself. That
session can write to every scratch, which suits work across scratches. Its
New Session row shows a **New scratch** chip to start in a new scratch
instead. Set `registerRoot: false` to stop registering the root.

## Archiving a scratch

When every session in a scratch is archived, the plugin:

1. Waits until those sessions stop running anything: the turn, subagents,
   background jobs, schedules and terminals. After two minutes it gives up and
   leaves the directory where it is; the next Harness start tries again.
2. Checks the sessions are still archived (the archive notice offers Undo).
3. Moves the directory to `~/.dsh/scratchpad/.archived/<name>` and removes
   the workspace from the sidebar. The archived sessions stay under
   **Ungrouped**, hidden like any archived session.

Unarchiving any of those sessions moves the directory back before the sidebar
shows the session again, registers the workspace, and attaches its sessions.
Forking an archived session does the same. A workspace restored this way
starts at the top of the sidebar.

Archiving a session in the root workspace moves nothing. Deleting a scratch
workspace from the sidebar only removes the registration, as it does for any
workspace; the plugin leaves that directory alone and does not register it
again. Nothing is ever deleted: empty `.archived` entries stay until you
remove them.

The Host half catches up at startup with archives and unarchives made while it
was off.

## Settings

Edit them on the plugin's settings page, or in the profile patch under the
`scratchpad` row. Changing either restarts the Host half.

| Field          | Default             | Meaning                                                            |
| -------------- | ------------------- | ------------------------------------------------------------------ |
| `root`         | `~/.dsh/scratchpad` | Directory that holds the scratches. `~` is the Host user's home.   |
| `registerRoot` | `true`              | Register the root as a workspace too, for Workspace Tree grouping. |

The root does not follow `$DSH_HOME`; set `root` when you moved the Harness
home.

## How it works

1. The browser half creates the session with `sessions.create({ cwd })`. The
   Host creates the directory with the session, which fixes the session's
   working directory and file-policy root.
2. The Host half sees the new Agent in `agent/created`, registers the root
   and the scratch with `workspaceRegistry.create`, and attaches the session.
   The browser waits for that workspace and opens it like any other.
3. The Host half follows the registry's archive set through the storage
   `domain/changed` event, which fires after each durable registry write and
   before any browser hears of it. Archive moves wait in the background;
   unarchive moves run synchronously inside the event.
4. Every move is one `rename` inside the root. Files are never copied or
   deleted.

## Limits

- **Deleting `~/.dsh` deletes the scratches too.** Set `root` elsewhere to
  keep them apart from Harness data.
- The archive bookkeeping reads Harness internals: the Workspace registry's
  stored state (`archivedSessionIds`) through `domain/changed`, and the
  `workspace/session-activity` check. A Harness update within
  `>=0.2.1-rc.5 <0.3.0` can still change them; the move then stops happening
  while creation keeps working.
- Waiting for running work covers what the Harness reports. A persistent
  shell, an MCP server or any process writing to an absolute path in the
  scratch is not tracked, and can recreate files at the old path after the
  move.
- A restored scratch loses its position in the sidebar and its session order
  is rebuilt newest first. A custom workspace title is reset to the directory
  name.
- The browser decides name collisions from the sessions and workspaces it
  knows. A directory created by hand with the same name is reused as is.
- A root reached through a symlink is matched by its canonical path on the
  Host. In the browser, reusing the newest scratch and the root chip compare
  the configured spelling only.
- The built-in **New Session** of a scratch workspace opens a second session
  in the same directory: the Harness offers no way to change it per workspace.
- English only.
