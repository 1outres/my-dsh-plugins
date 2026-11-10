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

| Plugin                                                                               | Row id                | What it does                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@1outres/dsh-plugin-background`](packages/dsh-plugin-background)                   | `background`          | Paints an image behind the whole Web UI, with panel opacity, dim and blur controls.                                                                                       |
| [`@1outres/dsh-plugin-claude-subscription`](packages/dsh-plugin-claude-subscription) | `claude-subscription` | Unofficial. Adds your own Claude subscription as a model provider, through the official `claude` CLI.                                                                     |
| [`@1outres/dsh-plugin-edit-message`](packages/dsh-plugin-edit-message)               | `edit-message`        | Adds Edit beside Copy on your sent messages: the conversation restarts from just before that message with the edited text, and the old version is archived.               |
| [`@1outres/dsh-plugin-mobile`](packages/dsh-plugin-mobile)                           | `mobile`              | Adds phone refinements to the Web UI (keyboard fit, Enter adds a line, drawer swipes, notches) and makes it an installable app with a service worker and an offline page. |
| [`@1outres/dsh-plugin-model-picker`](packages/dsh-plugin-model-picker)               | `model-picker`        | Replaces the composer model selector with a searchable one: favorites and recent models first, every provider grouped, effort in the same menu.                           |
| [`@1outres/dsh-plugin-notify`](packages/dsh-plugin-notify)                           | `notify`              | Notifies you when an approval, a question, or a finished turn needs you: in the browser while the page is in the background, and by Web Push to devices that turn it on.  |
| [`@1outres/dsh-plugin-playwright`](packages/dsh-plugin-playwright)                   | `playwright`          | Gives each top-level session its own isolated Playwright browser context, with browser automation tools from Playwright MCP.                                              |
| [`@1outres/dsh-plugin-remote`](packages/dsh-plugin-remote)                           | `remote`              | Works on remote SSH hosts and on serial consoles behind `dsh-serial-agent`: commands, files, and interactive shells, with passwords typed in a masked card.               |
| [`@1outres/dsh-plugin-scratchpad`](packages/dsh-plugin-scratchpad)                   | `scratchpad`          | Opens a session in a new empty directory registered as its own workspace, for work outside any repository; archiving moves the directory aside.                           |

Row ids are the configuration namespaces. Disable a plugin by setting `disabled: true` on its row in the profile patch, or uninstall the bundle. Each plugin package name in the table is also the install spec for that plugin alone.

## Presets

| Preset id     | Name            | What it is                                                                                                                                                    |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creator-ptc` | `Creator (PTC)` | The shipped Creator preset, with PTC tool presentation: the model calls every tool through `run_code` and a generated SDK instead of native function calling. |

A preset is a full copy of a shipped preset, because a preset cannot inherit from another. Re-copy the child list (and keep the single `tool-presentation` row) when a DSH upgrade changes the Creator preset it mirrors.

## Requirements

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` (the mobile plugin follows the
  navigation drawer and phone focus behavior that `0.2.2` ships).
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
- `packages/*/src/worker/*.ts` build to `lib/<name>.js` as **classic scripts**
  for service workers (the mobile plugin's `src/worker/sw.ts` becomes
  `lib/sw.js`).

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

## Serial agent

[`serial-agent/`](serial-agent) holds `dsh-serial-agent`, the Go daemon that
lets the remote plugin reach serial consoles on client PCs. It is not an npm
package; the root flake ships it:

```sh
nix run github:1outres/my-dsh-plugins#dsh-serial-agent -- pubkey
```

The flake also exports `nixosModules.dsh-serial-agent` and
`darwinModules.dsh-serial-agent`. See [`serial-agent/README.md`](serial-agent/README.md).

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
  dsh-plugin-mobile/      @1outres/dsh-plugin-mobile — phone refinements, keyboard fit, PWA service worker
  dsh-plugin-model-picker/
                          @1outres/dsh-plugin-model-picker — searchable composer model picker
  dsh-plugin-notify/      @1outres/dsh-plugin-notify — browser notifications and Host-sent Web Push
  dsh-plugin-playwright/  @1outres/dsh-plugin-playwright — isolated Playwright browser per session
  dsh-plugin-remote/      @1outres/dsh-plugin-remote — remote SSH tools, password cards, interactive sessions
  dsh-plugin-scratchpad/  @1outres/dsh-plugin-scratchpad — scratch directories as workspaces
serial-agent/             dsh-serial-agent — Go daemon that serves client PC serial ports to the remote plugin (Nix flake)
scripts/
  build.mjs               esbuild host/client/standalone build + client wrapper
  new-plugin.mjs          plugin generator
```

Every `packages/dsh-plugin-*` directory ships its own one-row
`cordis.patch.yml`, which is what makes the package a bundle that installs
alone.

## License

MIT
