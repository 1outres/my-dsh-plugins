# my-dsh-plugins

Personal plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Every plugin is its own npm package and its own bundle, so you can install one
plugin or all of them.

Install a single plugin:

```sh
dsh plugin add @1outres/dsh-plugin-notify
```

Install every plugin in this repository in one step:

```sh
dsh plugin add @1outres/dsh-plugins
```

Enable one or the other for a given plugin: the bundle and the plugin's own
bundle insert the same row id, so selecting both inserts that row twice.

## Plugins

| Plugin                                                                               | Row id                | What it does                                                                                                                                                |
| ------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@1outres/dsh-plugin-background`](packages/dsh-plugin-background)                   | `background`          | Paints an image behind the whole Web UI, with panel opacity, dim and blur controls.                                                                         |
| [`@1outres/dsh-plugin-claude-subscription`](packages/dsh-plugin-claude-subscription) | `claude-subscription` | Unofficial. Adds your own Claude subscription as a model provider, through the official `claude` CLI.                                                       |
| [`@1outres/dsh-plugin-edit-message`](packages/dsh-plugin-edit-message)               | `edit-message`        | Adds Edit beside Copy on your sent messages: the conversation restarts from just before that message with the edited text, and the old version is archived. |
| [`@1outres/dsh-plugin-model-picker`](packages/dsh-plugin-model-picker)               | `model-picker`        | Replaces the composer model selector with a searchable one: favorites and recent models first, every provider grouped, effort in the same menu.             |
| [`@1outres/dsh-plugin-notify`](packages/dsh-plugin-notify)                           | `notify`              | Sends a desktop notification when an approval, a question, or a finished turn needs you while the Web UI is in the background.                              |

Row ids are the configuration namespaces. Disable a plugin by setting `disabled: true` on its row in the profile patch, or uninstall the bundle. Each plugin package name in the table is also the install spec for that plugin alone.

## Presets

| Preset id     | Name            | What it is                                                                                                                                                    |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creator-ptc` | `Creator (PTC)` | The shipped Creator preset, with PTC tool presentation: the model calls every tool through `run_code` and a generated SDK instead of native function calling. |

A preset is a full copy of a shipped preset, because a preset cannot inherit from another. Re-copy the child list (and keep the single `tool-presentation` row) when a DSH upgrade changes the Creator preset it mirrors.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`.
- Node.js 22 or newer.
- pnpm 12 (the repository pins `pnpm@12.9.0` in `package.json`).

On NixOS, `nix develop` provides Node, pnpm and git:

```sh
nix develop
pnpm install
```

## Development

```sh
pnpm install
pnpm build        # builds packages/*/src into packages/*/lib
pnpm dev          # esbuild watch mode
pnpm typecheck
pnpm lint
pnpm test
```

The two halves of a client plugin are unusual and the build script handles the
format for you:

- the host half is an ESM module (`lib/index.js`) that the Loader imports;
- the browser half must be a **classic script** that calls
  `window.__ModuleLoader__.load({ id, factory })` synchronously. `scripts/build.mjs`
  bundles the browser entry as CommonJS (React stays external) and wraps it in
  that factory.

To try the working tree against a live profile, link the package instead of
publishing:

```sh
dsh plugin add link:$PWD/packages/dsh-plugins            # every plugin
dsh plugin add link:$PWD/packages/dsh-plugin-notify      # just one
```

Rebuilding `lib/client.js` is enough for the open page to hot-swap the plugin
(the client HMR watcher polls the artifact); host-half changes need a profile
recomposition or a restart.

## Adding a plugin

```sh
pnpm new-plugin my-thing
```

The generator creates `packages/dsh-plugin-my-thing`, adds it as a workspace
dependency of the bundle, appends its row to
`packages/dsh-plugins/cordis.patch.yml`, and writes the one-row
`cordis.patch.yml` that makes the package installable on its own. Then edit the
generated source and run `pnpm build`.

Each plugin is its own package: the client module loader resolves exactly one
`exports["./client"]` per package, so separate UI plugins must live in separate
packages. The `@1outres/dsh-plugins` bundle stays the one-command install for
everything; each plugin package is also installable alone.

## Releasing

Keep every package on the same version, then push a `v*` tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs
typecheck, lint, tests and the build, refuses a tag that does not match every
`package.json` version, and publishes the workspace to npm with provenance. It
needs an `NPM_TOKEN` repository secret: an npm automation token allowed to
publish the `@1outres` scope.

To publish from a local checkout instead:

```sh
pnpm release   # build, then pnpm -r publish --access public
```

`pnpm` replaces the bundle's `workspace:*` dependency with the published
version, so the plugins are published before the bundle.

## Layout

```
packages/
  dsh-plugins/            @1outres/dsh-plugins — the bundle (patch + dependencies)
  dsh-plugin-background/  @1outres/dsh-plugin-background — host + browser halves
  dsh-plugin-claude-subscription/
                          @1outres/dsh-plugin-claude-subscription — LLM provider on the `claude` CLI
  dsh-plugin-edit-message/
                          @1outres/dsh-plugin-edit-message — edit a sent message and restart from it
  dsh-plugin-model-picker/
                          @1outres/dsh-plugin-model-picker — searchable composer model picker
  dsh-plugin-notify/      @1outres/dsh-plugin-notify — browser-side desktop notifications
scripts/
  build.mjs               esbuild host/client/standalone build + client wrapper
  new-plugin.mjs          plugin generator
```

Every `packages/dsh-plugin-*` directory ships its own one-row
`cordis.patch.yml`, which is what makes the package a bundle that installs
alone.

## License

MIT
