# @1outres/dsh-plugin-claude-usage

Shows the remaining Claude subscription usage as a row in the DeepSeek Harness
sidebar footer.

The plugin has no settings. It reads the rate limit headers of every Claude
answer that the [`claude-subscription`](../dsh-plugin-claude-subscription)
plugin makes. It does not start its own model call. When `claude-subscription`
is disabled or not installed, the required `claudeSubscriptionUsage` service is
absent, this plugin stays inactive, and no row is shown.

Install it with the provider:

```sh
dsh plugin add @1outres/dsh-plugin-claude-subscription
dsh plugin add @1outres/dsh-plugin-claude-usage
```

Or install the [`@1outres/dsh-plugins`](../dsh-plugins) bundle, which inserts
both rows.

## Sidebar footer

The row sits directly after "New scratch" and before the "… More" launcher. On
phones the sidebar is the left drawer, so the row appears there while the
drawer is open.

A wide sidebar shows the mark and the primary window: the five-hour window when
the account has one, otherwise the seven-day window, with its meter, used
percent, and time left. The other window follows with its percent only.
Warning and limit states use the host warning and error colors. A passed reset
shows "—". Before the first Claude answer the row shows only the mark and "—".
Hover for each window's reset date and the snapshot age.

In the 56px rail the row is a 16px ring for the primary window's utilization,
with no text. Its title tooltip still holds the full window details.

Select the row to open the per-model report from `claude ... /usage`. The
popover opens above the row in a wide sidebar and to its right in the rail. It
lists each meter with its percent and time left, plus extra usage when enabled.
Loading and errors are one muted mark. This local command makes no model
request. Escape or a click outside closes the popover, and focus returns to the
row.

## Requirements

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`.
- The `claude-subscription` plugin, enabled and logged in.
- The official Claude Code CLI, as the provider requires.
