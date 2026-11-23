# @1outres/dsh-plugin-advisor

Lets the agent consult a stronger advisor model at key moments of a task. It
recreates the Claude Code `/advisor` tool for DeepSeek Harness: the agent gets
one tool, `advisor`, with no parameters, and the advisor answers with guidance
only.

```sh
dsh plugin add @1outres/dsh-plugin-advisor
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `advisor` row.

## Settings

Open **Settings** > **Advisor**. The page lists every model of every provider
in one menu, grouped by provider, with **None** to turn the advisor off. When
the chosen model has reasoning efforts, a second menu picks one. Every change
applies to the next advisor call without a restart.

The page writes these fields of the `advisor` row:

| Field             | Default  | Meaning                                                                     |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| `provider`        | empty    | Provider id of the advisor model                                            |
| `model`           | empty    | Model id of the advisor model within that provider                          |
| `reasoningEffort` | empty    | Reasoning effort id for the advisor; empty uses the model default           |
| `adviceWordLimit` | `150`    | The advisor is asked to keep each answer under this many words (20 to 2000) |
| `timeoutMs`       | `300000` | Milliseconds one advisor call may take before it fails (at least 1000)      |

Choosing a model writes `provider` and `model` in one change and clears
`reasoningEffort`, so an effort of the old model never carries over. A model
that was saved but is no longer listed stays in the menu, marked as not
available.

The tool is offered while `provider` or `model` is set. When only one of
them is set (for example after a hand edit of `cordis.patch.yml`), a call
fails with `invalid_config` instead of guessing the other. The plugin does not
check that the advisor is stronger than the agent's model; pick the pairing
yourself.

## What the agent sees

The tool description holds the same guidance Claude Code gives its main model:
call the advisor before substantive work, when stuck, when changing approach,
and before declaring the task done, and give the advice serious weight. It also
asks the agent to call the advisor on its own, so the advisor sees every
result. Sub-agents get the tool too.

## What the advisor sees

One call sends one request to the advisor model through `ctx.llm.stream()`,
with `purpose: "advisor"` and the calling session id. The request has a fixed
system prompt for the advisor role and no tools. The user messages quote the
calling session as records, in this order:

1. the agent's tool definitions, in full;
2. every message of the session as the agent sees it now, including the system
   prompt, user messages, the agent's text and tool calls, and tool results.
   Reasoning is left out. Images are shown as `[image attachment]`, and files
   as the text the provider would receive;
3. a short request to advise now.

Earlier records stay byte-identical as the session grows, so a provider with
prefix caching can reuse them on the next advisor call.

When the agent calls `advisor` from inside a `run_code` program, the calls that
program made before it are not in the session yet. The request says so.

## Cost

Each advisor call adds one request to the advisor model, whose input is the
whole session. It usually also adds one step of the agent's own model, because
the agent continues after the tool result. Sessions where the agent never calls
the advisor cost nothing extra.

## Errors

A failed call returns a tool error that tells the agent to continue without
advice. The error code is one of `invalid_config`, `too_many_requests`,
`overloaded`, `prompt_too_long`, `execution_time_exceeded`,
`model_not_found`, and `unavailable`. Cancelling the turn cancels the
advisor request.
