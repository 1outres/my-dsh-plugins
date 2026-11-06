# @1outres/dsh-plugin-background

Paint an image behind the whole DeepSeek Harness Web UI. The interface stays
usable: panels become translucent, a configurable veil keeps text readable, and
the image can be blurred. Surfaces drawn over the conversation (the Settings
dialog, the right panel while it covers the page, and the sidebar drawer of
[`@1outres/dsh-plugin-mobile`](../dsh-plugin-mobile)) stay opaque, so their text
never sits on top of the chat.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-background
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `background` row.

## Settings

Open **Settings → Background**.

| Field             | Default | Meaning                                                                                |
| ----------------- | ------- | -------------------------------------------------------------------------------------- |
| Enable background | on      | Master switch. No image set means no visual change.                                    |
| Image path or URL | empty   | Absolute path on the machine running DSH, or an `https://` URL.                        |
| Panel opacity     | 70%     | How opaque interface surfaces stay over the image. 100% hides the image behind panels. |
| Dim               | 30%     | Black veil between the image and the interface; raise it when text is hard to read.    |
| Blur              | 0 px    | Blurs the image (0–40 px).                                                             |

**Reset to defaults** clears the stored overrides and falls back to the schema
defaults.

### Local images

Local paths are served through the Harness's authenticated `GET /api/file?path=`
route, so the image never leaves the Host. Example:

```
/home/you/Pictures/wallpaper.jpg
```

The route is authenticated by the existing browser session; nothing is copied
into the profile. URLs must be `https://` because the GUI is served over HTTPS
and browsers block mixed content.

## How it works

There is no background slot in the Harness shell, so this plugin does not render
a component. Instead it:

1. injects one global stylesheet that paints `html::before` (image),
   `html::after` (veil) and lifts `#root` above both;
2. reads the active theme's alias colors from the stylesheet and re-registers
   them through `ctx.theme.overrideTokens()` as `color-mix(... transparent)`
   surfaces, so panels, cards, popovers and the sidebar let the image through;
3. restores the opaque alias colors on the surfaces that cover the
   conversation: the body-portaled Settings dialog
   (`[data-shortcut-modal="settings"]`), the right panel in fullscreen
   (`[data-sidebar-right-panel="fullscreen"]`, used below 768px) and its
   floating tabs, and the mobile plugin's sidebar drawer (under
   `html[data-dsh-mobile]`). Only tokens are re-declared, so a collapsed panel
   stays see-through;
4. registers a `settings.section` page that reads and writes the Host settings
   entry (`background`) through `ctx.configForms`.

Theme switches re-read the palette, so the effect follows light and dark mode.

## Limits

- One image, shared by every authenticated browser.
- No per-theme image, video, GIF rotation or slideshow (v1).
- The image is repainted by the browser; large files are fine, but the Host has
  to read them on every load through `/api/file`.
