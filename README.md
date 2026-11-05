# my-dsh-plugins

Personal plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), packaged as one bundle.

One install adds every plugin in this repository:

```sh
dsh plugin add @1outres/dsh-plugins
```

## Plugins

| Plugin                                                             | Row id       | What it does                                                                                                                   |
| ------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [`@1outres/dsh-plugin-background`](packages/dsh-plugin-background) | `background` | Paints an image behind the whole Web UI, with panel opacity, dim and blur controls.                                            |
| [`@1outres/dsh-plugin-notify`](packages/dsh-plugin-notify)         | `notify`     | Sends a desktop notification when an approval, a question, or a finished turn needs you while the Web UI is in the background. |

Row ids are the configuration namespaces. Disable a plugin by setting `disabled: true` on its row in the profile patch, or uninstall the bundle.

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

To try the working tree against a live profile, link the bundle instead of
publishing:

```sh
dsh plugin add link:$PWD/packages/dsh-plugins
```

Rebuilding `lib/client.js` is enough for the open page to hot-swap the plugin
(the client HMR watcher polls the artifact); host-half changes need a profile
recomposition or a restart.

## Adding a plugin

```sh
pnpm new-plugin my-thing
```

The generator creates `packages/dsh-plugin-my-thing`, adds it as a workspace
dependency of the bundle, and appends its row to
`packages/dsh-plugins/cordis.patch.yml`. Then edit the generated source and run
`pnpm build`.

Each plugin is its own package: the client module loader resolves exactly one
`exports["./client"]` per package, so separate UI plugins must live in separate
packages. The bundle is the only package users install.

## Releasing

Keep every package on the same version and publish the workspace:

```sh
pnpm release   # build, then pnpm -r publish --access public
```

`pnpm` replaces the bundle's `workspace:*` dependency with the published
version. Publish the plugin packages before the bundle if you publish by hand.

## Layout

```
packages/
  dsh-plugins/            @1outres/dsh-plugins — the bundle (patch + dependencies)
  dsh-plugin-background/  @1outres/dsh-plugin-background — host + browser halves
  dsh-plugin-notify/      @1outres/dsh-plugin-notify — browser-side desktop notifications
scripts/
  build.mjs               esbuild host/client build + client wrapper
  new-plugin.mjs          plugin generator
```

## License

MIT
