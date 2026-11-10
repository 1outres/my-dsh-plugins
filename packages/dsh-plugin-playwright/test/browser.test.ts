import { describe, expect, test } from "vitest"
import { Config, resolveConfig } from "../src/config"
import { SharedBrowser } from "../src/host/browser"

describe("SharedBrowser", () => {
  test("fails with a clear error when executablePath does not exist", async () => {
    const browser = new SharedBrowser(
      resolveConfig(Config({ executablePath: "/does/not/exist/chromium" })),
    )
    await expect(browser.get()).rejects.toThrow(/executablePath does not exist/)
    expect(browser.isRunning()).toBe(false)
    await browser.close()
  })
})
