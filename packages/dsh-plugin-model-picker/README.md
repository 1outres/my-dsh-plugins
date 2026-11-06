# @1outres/dsh-plugin-model-picker

Replace the composer's model selector in the DeepSeek Harness Web UI with one
that stays usable when several providers list hundreds of models: it opens
straight into search, keeps favorites and recent models at the top, and
chooses reasoning effort in the same menu.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-model-picker
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `model-picker` row.

## Using the picker

Click the model name in the composer. The menu opens above it with the
search field focused.

- **Empty search**: ★ Favorites, then the five most recent models you picked
  here (favorites excluded), then every provider with its heading pinned
  while you scroll. A favorite or recent model also stays in its provider's
  list.
- **Typing**: one ranked list, with the provider beside each model. Every
  space-separated word must appear in the provider name, the model name, or
  the model id, so `opus 4.6` finds `Anthropic: Claude Opus 4.6`. Exact
  matches come first, then prefixes, word starts, and other substrings; ties
  go to favorites, then recent models, then catalog order.
- **Effort**: the row at the bottom lists the current model's reasoning
  levels (plus Default when the model has no default level). Each model
  remembers the level you last used with it, so switching back restores it.
  A model without a remembered level keeps the current one when it offers
  it, and otherwise falls back to its own default.

Each row shows a check for the current model, the model name, and the model
id when it differs from the name.

| Key                     | Action                                               |
| ----------------------- | ---------------------------------------------------- |
| `↑` `↓`                 | Move the highlight (wraps around)                    |
| `PageUp` `PageDown`     | Move by one page                                     |
| `Home` `End`            | First or last model                                  |
| `Enter`                 | Select the highlighted model                         |
| `Ctrl+D` / `⌘D`         | Add or remove the highlighted model from favorites   |
| `Tab`                   | Move to the Effort row; `←` `→` choose, `Enter` sets |
| `Shift+Tab` (in search) | Close                                                |
| `Esc`                   | Close and return focus to the model button           |

`Ctrl+D` replaces the browser's bookmark shortcut only while the menu is open.

## Settings

There is no Settings page. Favorites are saved in the plugin's settings entry,
so they follow you to every browser that opens this profile; the star buttons
write them. To edit the list by hand, change the `model-picker` row in the
profile patch:

```yaml
- id: model-picker
  name: "@1outres/dsh-plugin-model-picker"
  config:
    favorites:
      - provider: orcarouter
        model: anthropic/claude-opus-4.6
      - provider: claude-subscription
        model: claude-opus-5-5
```

Recent models and the effort remembered for each model are kept in this
browser's local storage (`dsh-plugin-model-picker:recent:v1` and
`dsh-plugin-model-picker:efforts:v1`), so every browser has its own lists.
Only selections made in this picker count.

A favorite or recent model whose provider is gone disappears from the menu but
stays saved, and comes back when the provider does.

## How it works

1. The browser half registers the composer seat `conversation.input.model` at
   priority `-100`, above the shipped selector at `0`. Disabling the plugin
   removes that entry and the shipped selector returns.
2. It reads and changes the model through `ctx.modelDirectories`, the
   per-Session directory of `@deepseek-ai/dsh-client-ui-model-selection`. The
   picker and `/model` therefore share one state: the pending selection,
   catalog refreshes after provider or credential changes, and per-provider
   load failures.
3. A selection applies from the Session's next request, like the shipped
   selector, and the Host also saves it as the default for new Sessions.
4. The host half only declares the `favorites` schema and turns off the
   generated Settings page.

The picker copies the shipped selector's trigger, compact icon display, locked
and subagent states, pending spinner, error strips with Retry, and error
toasts. Its markup and styles are copied from the shipped controls and share
only theme tokens with the host.

## Limits

- Other plugins' `conversation.input.model.label` decorations are not shown:
  that slot belongs to the shipped selector, which stays registered underneath.
  Each name keeps the `data-provider-id` and `data-model-id` attributes, so
  attribute-based CSS still applies.
- `ctx.modelDirectories` is not a catalogued Harness service. If a Harness
  update removes it, the plugin stays inactive and the shipped selector is
  shown.
- The list is not virtualized; a few hundred models render without delay.
- English only.
