/** The offline page the worker keeps on its own: the Host serves no assets to it. */

export type OfflineLanguage = "en" | "zh" | "ja"

export const OFFLINE_STATUS = 503
export const OFFLINE_CONTENT_TYPE = "text/html; charset=utf-8"

interface OfflineCopy {
  readonly lang: string
  readonly title: string
  readonly body: string
  readonly retry: string
}

const COPY: Record<OfflineLanguage, OfflineCopy> = {
  en: {
    lang: "en",
    title: "DeepSeek Harness is offline",
    body: "The app cannot reach the Harness right now. Check that the Host is running, then try again.",
    retry: "Retry",
  },
  zh: {
    lang: "zh",
    title: "无法连接到 DeepSeek Harness",
    body: "应用暂时无法连接到 Harness。请确认 Host 正在运行，然后重试。",
    retry: "重试",
  },
  ja: {
    lang: "ja",
    title: "DeepSeek Harness に接続できません",
    body: "アプリは現在 Harness に接続できません。Host が動作しているか確認して、もう一度お試しください。",
    retry: "再試行",
  },
}

/** Pick the page language from a browser language tag. */
export function pickLanguage(language: string): OfflineLanguage {
  const tag = language.trim().toLowerCase()
  if (tag.startsWith("zh")) return "zh"
  if (tag.startsWith("ja")) return "ja"
  return "en"
}

/** The offline page, with a button that reloads the current URL. */
export function renderOfflinePage(language: string): string {
  const copy = COPY[pickLanguage(language)]
  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${copy.title}</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 24px;
        box-sizing: border-box;
        background: #ffffff;
        color: #1f2328;
        font: 15px/1.6 system-ui, -apple-system, sans-serif;
        text-align: center;
      }
      h1 { margin: 0; font-size: 18px; }
      p { margin: 0; max-width: 32em; color: #59636e; }
      button {
        margin-top: 8px;
        padding: 8px 16px;
        border: 1px solid #d1d9e0;
        border-radius: 8px;
        background: #f6f8fa;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0d1117; color: #e6edf3; }
        p { color: #9198a1; }
        button { border-color: #3d444d; background: #212830; }
      }
    </style>
  </head>
  <body>
    <h1>${copy.title}</h1>
    <p>${copy.body}</p>
    <button id="retry" type="button">${copy.retry}</button>
    <script>
      document.getElementById("retry").addEventListener("click", function () {
        location.reload()
      })
    </script>
  </body>
</html>
`
}

/** The offline page as a response: 503, so the browser keeps no stale copy. */
export function offlineResponse(language: string): Response {
  return new Response(renderOfflinePage(language), {
    status: OFFLINE_STATUS,
    headers: { "Content-Type": OFFLINE_CONTENT_TYPE },
  })
}
