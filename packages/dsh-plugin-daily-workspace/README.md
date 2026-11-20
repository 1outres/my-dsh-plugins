# @1outres/dsh-plugin-daily-workspace

A workspace for each day. At every start, and then within five minutes of each
local midnight, the plugin makes sure today's folder exists and registers its
year folder, its month folder, and that folder as workspaces. With **Workspace
Tree** grouping the sidebar then reads `2026 → 11 → 20 → sessions`, so a day's
sessions sit under their date.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-daily-workspace
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `daily-workspace` row.

## What it does

The folder is `~/Documents/YYYY/MM/DD` in the Host's local time: the same
folder that `date +%F | tr - /` names, with a zero-padded month and day. The
plugin creates the day folder and registers the folders; it never touches
`~/today` or anything else, and the root itself is never registered.

Registration runs in this order: the year folder, the month folder, then the
day folder. Every `workspaceRegistry.create` call prepends the workspace to the
sidebar, so today's folder ends up on top, above its month and its year. No
title is set: the registry titles a workspace with its directory name, so they
read `2026`, `11`, and `20`.

A folder that is already registered is skipped. The plugin compares canonical
paths (`fs.realpath`) with the registered ones, so a folder reached through a
symlink is recognized.

## The Workspace Tree tip

Choose **View options → Group by → Workspace Tree** in the Workspaces header.
The grouping nests registered workspaces by path prefix, and the year and month
registrations are what give the day folder its place in the tree. The grouping
choice is saved per browser and defaults to flat.

## Settings

Edit them on the plugin's settings page, or in the profile patch under the
`daily-workspace` row. Changing the root restarts the Host half.

| Field  | Default       | Meaning                                                            |
| ------ | ------------- | ------------------------------------------------------------------ |
| `root` | `~/Documents` | Directory that holds the day folders. `~` is the Host user's home. |

A root that is not absolute after `~` expansion logs one warning and nothing is
managed.

## How it works

1. `apply` resolves the root, runs one registration pass at once, and starts a
   check timer.
2. A check wakes every five minutes, or sooner at local midnight when that is
   less than five minutes away. It reads the clock when it fires and compares
   the local date (`YYYY-MM-DD`) with the date of the last started pass; when
   the date changed, one pass runs. A machine that sleeps through midnight
   therefore registers the new day within five minutes of waking.
3. The next midnight is measured with the local `Date` constructor, so a
   daylight saving change still lands on local midnight. Timers can fire a
   little early: a pass takes the time it actually starts, and the next check is
   measured from that moment.
4. A pass creates the day folder with `mkdir -p`, then registers the year, the
   month, and the day through `workspaceRegistry.create` when their canonical
   path is not in `workspaceRegistry.list()`.
5. Passes never overlap: a trigger that arrives during a pass waits for it.
6. The check timer is cleared on dispose, when the plugin is disabled or the
   Host stops.

Every failure is logged as a warning; nothing is thrown out of `apply` or the
timer, and a failure leaves the next check scheduled.

## Limits

- The date is the Host's local time zone, not the browser's.
- Only today is registered. Past days stay as they are: the plugin never
  deletes, moves, or renames a folder.
- A year, month, or day registration removed by hand comes back at the next
  start or after the next midnight, while its folder still exists.
- The plugin adds no browser half and no session commands: it only creates
  folders and registers workspaces.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
Its unit tests use fakes and need no running Harness.

## License

MIT
