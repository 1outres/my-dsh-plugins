# @1outres/dsh-plugin-exa

Use [Exa](https://exa.ai) for DeepSeek Harness web search and web fetch. The
plugin registers a search provider and a fetch provider, both with the id
`exa`, and selects them for the shipped `web_search` and `web_fetch` tools.
A Settings page stores the API key in the DSH credential store and edits the
search options.

Install just this plugin:

```sh
dsh plugin add @1outres/dsh-plugin-exa
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `exa` row.

## Set the API key

Open **Settings → Exa**, type the key, and choose **Save key**. The key is
written through `ctx.remote.credentials`, so it never enters the settings file
or the profile patch. **Remove key** deletes the stored key again.

A key can also come from the environment. Export `EXA_API_KEY` (or the name in
**Credential name**) before starting DSH; the page then says the key comes from
the environment and disables the input.

## Settings

| Field                        | Default              | Meaning                                                                   |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------- |
| API key                      | empty                | Stored in the DSH credential store, never in the settings file.           |
| Search type                  | `auto`               | Exa search mode: `auto`, `lite`, `deep-lite`, or `deep`.                  |
| Search result content        | `highlights`         | `highlights` keeps short excerpts; `text` keeps the full page text.       |
| Characters per search result | `1000`               | 100 to 20000 characters of highlights or text for each result.            |
| Only these domains           | empty                | One domain per line. Empty means no include filter.                       |
| Never these domains          | empty                | One domain per line. Empty means no exclude filter.                       |
| Characters per fetched page  | `100000`             | 1000 to 1000000 characters. A longer page is marked truncated.            |
| API base URL                 | `https://api.exa.ai` | Endpoint base. The provider appends `/search` or `/contents`.             |
| Credential name              | `EXA_API_KEY`        | Name of the stored credential or environment variable that holds the key. |

The same values live in the profile patch under the `exa` row. Every field is
volatile, so a saved change applies to the next search or fetch without a
restart. Invalid numbers are rejected on the Settings page before the Host is
asked to write them.

## What the providers send

Search calls `POST {baseURL}/search` with the query, the search type,
`numResults` (the tool's limit, clamped to 1 to 100, default 10), and the
configured content options. Domain filters are sent only when their list is not
empty. Sources keep one entry per URL, in Exa's order. Highlights become the
display snippet and the model summary; full text becomes the summary and a
300-character snippet cut at a word boundary. Exa notices are appended to the
model-facing content; Exa warnings go to the Host log only.

Fetch calls `POST {baseURL}/contents` for one URL and asks for one character
more than the fetch limit. A non-2xx page is returned as a fetch result with
that status code and an empty body, which is how the web seam reports a page
that answered with an error. A failed Exa request becomes a `WebError` with a
clear code and a message that never contains the key.

## Limits

- Both providers share the same option snapshot per operation; changing a
  setting during one search or fetch affects only the next operation.
- The search result count is bounded by the tool request as well as by Exa; the
  web seam can truncate further.
- `numResults` is the only Exa search control this plugin exposes. Recency,
  categories, and other Exa-only parameters are not sent.
- The plugin makes no network call from `available()` or `ready()`; those
  answer from configuration and the credential store only.

## License

MIT
