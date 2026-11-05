# @1outres/dsh-plugins

The all-in-one bundle. It contains no runtime code: its patch inserts one
Loader row per plugin, and its dependencies pull those plugin packages into the
profile.

```sh
dsh plugin add @1outres/dsh-plugins
```

Every plugin package is also its own bundle (it ships a one-row
`cordis.patch.yml`), so `dsh plugin add @1outres/dsh-plugin-notify` installs
just that plugin without this package. Enable one or the other for a given
plugin: both insert the same row id.

See the repository [README](../../README.md) for the full plugin list, the row
ids and the development workflow.
