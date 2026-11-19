# @1outres/dsh-plugin-claude-usage

Shows the remaining Claude subscription usage in a small status bar at the very
bottom of the DeepSeek Harness Web UI.

The bar has no settings. It reads the rate limit headers of every Claude answer
that the [`claude-subscription`](../dsh-plugin-claude-subscription) plugin makes.
It does not start its own model call. When `claude-subscription` is disabled or
not installed, the required `claudeSubscriptionUsage` service is absent, this
plugin stays inactive, and nothing is shown.

Install it with the provider:

```sh
dsh plugin add @1outres/dsh-plugin-claude-subscription
dsh plugin add @1outres/dsh-plugin-claude-usage
```

Or install the [`@1outres/dsh-plugins`](../dsh-plugins) bundle, which inserts
both rows.

## The bar

The bar shows the five-hour window first when the account has one, otherwise
the seven-day window: short label, small bar, used percent, and time left.
Other windows follow with their percent only. Warning and limit states use the
host warning and error colors. A passed reset shows "—". Before the first
Claude answer the bar shows only the mark and "—". Hover for each window's reset
date and the snapshot age. On a phone the bar adds the row's
`--dsh-shell-bottom-inset-bottom`, `-left` and `-right` properties to its own
padding, so its background reaches the screen edges.

Select the bar to open the per-model report from `claude ... /usage`. The
popover lists each meter with its percent and time left, plus extra usage when
it is enabled. Loading and errors are one muted mark. This local command makes
no model request. Escape or a click outside closes the popover, and focus
returns to the bar.

## Requirements

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`.
- The `claude-subscription` plugin, enabled and logged in.
- The official Claude Code CLI, as the provider requires.
