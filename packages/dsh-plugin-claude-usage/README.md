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

The first item is the five-hour window when the account has one, otherwise the
seven-day window. It shows the used percentage, a small bar, and the time left
until the window resets. Other windows follow with the local reset date and
time. The item turns yellow when the status is `allowed_warning` and red when it
is `rejected`. On a narrow screen only the first item stays visible.

Until the first Claude call answers, the bar says that usage is fetched on the
next Claude call. A window whose reset time has already passed shows "Reset (not
updated yet)" instead of a percentage, because the next answer has not arrived.

Select the bar to open the details. The popover shows every window, the overage
status, and when the snapshot arrived. It also runs `claude ... /usage` to list
usage by model, with a loading state and an error state. This local command
makes no model request. Escape or a click outside closes the popover, and focus
returns to the bar.

## Requirements

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`.
- The `claude-subscription` plugin, enabled and logged in.
- The official Claude Code CLI, as the provider requires.
