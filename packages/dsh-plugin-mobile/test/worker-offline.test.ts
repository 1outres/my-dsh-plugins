import { describe, expect, it } from "vitest"
import { serveNavigation } from "../src/worker/sw/navigation"
import {
  OFFLINE_CONTENT_TYPE,
  OFFLINE_STATUS,
  offlineResponse,
  pickLanguage,
  renderOfflinePage,
} from "../src/worker/sw/offline"

describe("offline page", () => {
  it("picks English, Chinese or Japanese from the browser language", () => {
    expect(pickLanguage("en-US")).toBe("en")
    expect(pickLanguage("zh-CN")).toBe("zh")
    expect(pickLanguage("zh")).toBe("zh")
    expect(pickLanguage("ja-JP")).toBe("ja")
    expect(pickLanguage("fr-FR")).toBe("en")
    expect(pickLanguage("")).toBe("en")
  })

  it("renders a localized page with a retry button", () => {
    const ja = renderOfflinePage("ja-JP")
    expect(ja).toContain('lang="ja"')
    expect(ja).toContain("再試行")
    expect(ja).toContain("location.reload()")
    expect(renderOfflinePage("zh-CN")).toContain('lang="zh"')
    expect(renderOfflinePage("zh-CN")).not.toBe(renderOfflinePage("en"))
    expect(renderOfflinePage("en")).toContain('lang="en"')
    expect(renderOfflinePage("en")).toContain("Retry")
  })

  it("answers with status 503 and HTML", async () => {
    expect(OFFLINE_STATUS).toBe(503)
    expect(OFFLINE_CONTENT_TYPE).toBe("text/html; charset=utf-8")
    const response = offlineResponse("ja-JP")
    expect(response.status).toBe(503)
    expect(response.headers.get("content-type")).toBe(OFFLINE_CONTENT_TYPE)
    expect(await response.text()).toContain("再試行")
  })

  it("serves a navigation from the network when it can", async () => {
    const request = new Request("https://example.test/")
    const network = new Response("app", { status: 200 })
    const seen: Request[] = []
    const response = await serveNavigation(
      request,
      async (passed) => {
        seen.push(passed)
        return network
      },
      "ja-JP",
    )
    expect(seen).toEqual([request])
    expect(response).toBe(network)
  })

  it("serves the offline page when the network fetch rejects", async () => {
    const response = await serveNavigation(
      new Request("https://example.test/"),
      async () => {
        throw new TypeError("Failed to fetch")
      },
      "ja-JP",
    )
    expect(response.status).toBe(503)
    expect(await response.text()).toContain("再試行")
  })
})
