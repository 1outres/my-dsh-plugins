import { gunzipSync, gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import {
  clientResponseHeaders,
  DEFAULT_UPSTREAM_POLICY,
  gzipEligible,
  gzipRequestBody,
  idleLimitMs,
  parseUpstreamUrl,
  selectProxy,
  UPSTREAM_IDLE_LIMIT_MS,
  upstreamRequestHeaders,
} from "../../src/relay/upstream"

const API = parseUpstreamUrl("https://api.example.com")

function catchFailure(run: () => unknown): NativeFailure {
  try {
    run()
  } catch (error) {
    if (error instanceof NativeFailure) return error
    throw error
  }
  throw new Error("expected a NativeFailure")
}

describe("parseUpstreamUrl", () => {
  it.each([
    ["https://api.anthropic.com", "api.anthropic.com", 443, true, ""],
    ["https://api.anthropic.com:8443/base/", "api.anthropic.com", 8443, true, "/base"],
    ["http://127.0.0.1:9/base", "127.0.0.1", 9, false, "/base"],
    ["http://127.8.8.8", "127.8.8.8", 80, false, ""],
    ["http://localhost:9", "localhost", 9, false, ""],
    ["http://[::1]:9", "::1", 9, false, ""],
  ])("accepts %s", (raw, hostname, port, secure, basePath) => {
    expect(parseUpstreamUrl(raw)).toMatchObject({ hostname, port, secure, basePath })
  })

  it.each([
    "http://api.anthropic.com",
    "http://localhost.example.com",
    "http://128.0.0.1",
    "ftp://127.0.0.1",
    "https://user@api.anthropic.com",
    "https://user:hunter2@api.anthropic.com",
    "https://api.anthropic.com/?q=hunter2",
    "https://api.anthropic.com/#hunter2",
    "not a url hunter2",
  ])("rejects %s without quoting it", (raw) => {
    const failure = catchFailure(() => parseUpstreamUrl(raw))
    expect(failure.code).toBe(FailureCode.relayError)
    expect(failure.message).toContain("HTTPS or a loopback HTTP")
    expect(failure.message).not.toContain("hunter2")
  })
})

describe("selectProxy", () => {
  const proxied = { HTTPS_PROXY: "http://proxy.test:8080" }

  it.each([
    ["api.example.com", "", true],
    ["api.example.com", ".example.com", false],
    ["example.com", "example.com", false],
    ["api.example.com", "example.com:443", false],
    ["api.example.com", "other.com, .example.com", false],
    ["api.example.com", "other.com .example.com", false],
    ["api.example.com", "*", false],
    ["notexample.com", "example.com", true],
  ])("for %s with NO_PROXY %j", (host, noProxy, expected) => {
    const route = selectProxy(parseUpstreamUrl(`https://${host}`), {
      ...proxied,
      NO_PROXY: noProxy,
    })
    expect(route !== null).toBe(expected)
  })

  it("matches a NO_PROXY port against the upstream port", () => {
    const target = parseUpstreamUrl("https://api.example.com:8443")
    expect(selectProxy(target, { ...proxied, NO_PROXY: "api.example.com:443" })).not.toBeNull()
    expect(selectProxy(target, { ...proxied, NO_PROXY: "api.example.com:8443" })).toBeNull()
  })

  it("follows the CLI's variable order and ignores ALL_PROXY", () => {
    const env: Record<string, string> = {}
    expect(selectProxy(API, env)).toBeNull()
    env.ALL_PROXY = "http://all.test:3128"
    expect(selectProxy(API, env)).toBeNull()
    env.HTTP_PROXY = "http://plain.test:3128"
    expect(selectProxy(API, env)).toEqual({ host: "plain.test", port: 3128 })
    env.HTTPS_PROXY = "http://upper.test"
    expect(selectProxy(API, env)).toEqual({ host: "upper.test", port: 80 })
    env.https_proxy = "http://lower.test:3128"
    expect(selectProxy(API, env)).toEqual({ host: "lower.test", port: 3128 })
  })

  it("lets an empty lowercase variable remove the uppercase one", () => {
    expect(selectProxy(API, { HTTPS_PROXY: "http://upper.test", https_proxy: "" })).toBeNull()
  })

  it("forgets uppercase HTTP_PROXY when it may come from a CGI request header", () => {
    const env = { REQUEST_METHOD: "GET", HTTP_PROXY: "http://client-set.test" }
    expect(selectProxy(API, env)).toBeNull()
    expect(selectProxy(API, { ...env, http_proxy: "http://own.test" })).toEqual({
      host: "own.test",
      port: 80,
    })
  })

  it("accepts a proxy with no scheme", () => {
    expect(selectProxy(API, { HTTPS_PROXY: "proxy.test:3128" })).toEqual({
      host: "proxy.test",
      port: 3128,
    })
  })

  it("never proxies a loopback HTTP upstream", () => {
    const env = { HTTPS_PROXY: "http://proxy.test:8080", HTTP_PROXY: "http://proxy.test:8080" }
    expect(selectProxy(parseUpstreamUrl("http://127.0.0.1:9"), env)).toBeNull()
  })

  it("builds basic proxy credentials from the percent-decoded URL parts", () => {
    const route = selectProxy(API, { HTTPS_PROXY: "http://user:p%40ss@proxy.test:8080" })
    const encoded = Buffer.from("user:p@ss").toString("base64")
    expect(route).toEqual({ host: "proxy.test", port: 8080, authorization: `Basic ${encoded}` })
  })

  it("leaves a stray percent sign in a proxy password as it is", () => {
    const route = selectProxy(API, { HTTPS_PROXY: "http://user:50%off@proxy.test:8080" })
    const encoded = Buffer.from("user:50%off").toString("base64")
    expect(route?.authorization).toBe(`Basic ${encoded}`)
  })

  it.each([
    "socks5://user:hunter2@proxy.test:1080",
    "https://user:hunter2@proxy.test:8443",
    "http://user:hunter2@proxy.test:notaport",
  ])("raises on the unsupported proxy %s without quoting it", (url) => {
    const failure = catchFailure(() => selectProxy(API, { HTTPS_PROXY: url }))
    expect(failure.code).toBe(FailureCode.relayError)
    expect(failure.message).toContain("CONNECT proxy")
    expect(failure.message).not.toContain("hunter2")
  })
})

describe("idleLimitMs", () => {
  it("is the socket timeout, capped at the upstream limit", () => {
    expect(UPSTREAM_IDLE_LIMIT_MS).toBe(180_000)
    expect(idleLimitMs(5_000)).toBe(5_000)
    expect(idleLimitMs(1_800_000)).toBe(180_000)
  })
})

describe("gzipEligible", () => {
  const CA_NAMES = [
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
  ]
  const VIA_PROXY = { host: "proxy", port: 80 }

  interface Case {
    url?: string
    proxy?: typeof VIA_PROXY
    env?: Record<string, string>
    encoding?: string
    size?: number
    expected: boolean
  }

  it.each<Case>([
    { expected: true },
    { url: "https://api.anthropic.com:443", expected: true },
    { url: "https://api.anthropic.com:444", expected: false },
    { url: "https://api.anthropic.com.evil.test", expected: false },
    { url: "https://other.test", env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: "1" }, expected: false },
    { proxy: VIA_PROXY, expected: false },
    { proxy: VIA_PROXY, env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: "1" }, expected: false },
    { encoding: "identity", expected: false },
    { size: 4095, expected: false },
    ...CA_NAMES.map((name) => ({ env: { [name]: "/fixture" }, expected: false })),
    { env: { SSL_CERT_FILE: "" }, expected: false },
    ...["0", "FaLsE", "NO", "off"].map((value) => ({
      env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: value },
      expected: false,
    })),
    { env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: "1" }, expected: true },
  ])("$url $env $encoding $size is $expected", (scenario) => {
    const eligible = gzipEligible({
      target: parseUpstreamUrl(scenario.url ?? "https://api.anthropic.com"),
      proxy: scenario.proxy ?? null,
      env: scenario.env ?? {},
      gzipOrigins: DEFAULT_UPSTREAM_POLICY.gzipOrigins,
      payloadBytes: scenario.size ?? 4096,
      contentEncoding: scenario.encoding,
    })
    expect(eligible).toBe(scenario.expected)
  })
})

describe("gzipRequestBody", () => {
  const payload = Buffer.from(JSON.stringify({ text: "fixture λ ".repeat(600) }))

  it.each([0, 256])("adds a newline and %d padding bytes", async (padBytes) => {
    const decoded = gunzipSync(await gzipRequestBody(payload, padBytes))
    expect(decoded.subarray(0, payload.length).equals(payload)).toBe(true)
    expect(decoded[payload.length]).toBe(0x0a)
    const pad = decoded.subarray(payload.length + 1)
    expect(pad.length).toBe(padBytes)
    expect([...pad].every((byte) => byte === 0x20 || byte === 0x09)).toBe(true)
  })

  it("uses level 3 with a zero modification time", async () => {
    const wire = await gzipRequestBody(payload, 0)
    const expected = gzipSync(Buffer.concat([payload, Buffer.from("\n")]), { level: 3 })
    expect(wire.equals(expected)).toBe(true)
    expect(wire.subarray(4, 8).equals(Buffer.alloc(4))).toBe(true)
  })

  it("keeps the padding within 256 bytes when it picks the length", async () => {
    const decoded = gunzipSync(await gzipRequestBody(payload))
    const pad = decoded.subarray(payload.length + 1)
    expect(pad.length).toBeLessThanOrEqual(256)
    expect(JSON.parse(decoded.toString())).toEqual(JSON.parse(payload.toString()))
  })
})

describe("upstreamRequestHeaders", () => {
  const target = parseUpstreamUrl("http://127.0.0.1:9")

  it("removes hop-by-hop fields and pins the transfer fields", () => {
    const headers = upstreamRequestHeaders(
      [
        "Host",
        "127.0.0.1:1",
        "Connection",
        "keep-alive",
        "Content-Length",
        "2",
        "Transfer-Encoding",
        "chunked",
        "Proxy-Authorization",
        "Basic secret",
        "Proxy-Connection",
        "keep-alive",
        "Accept-Encoding",
        "br",
        "Authorization",
        "Bearer token",
        "X-Fixture",
        "preserved",
      ],
      { target, bodyBytes: 7, gzip: false },
    )
    expect(headers).toEqual({
      Authorization: "Bearer token",
      "X-Fixture": "preserved",
      Host: "127.0.0.1:9",
      "Accept-Encoding": "identity",
      "Content-Length": "7",
    })
  })

  it("marks a compressed body and keeps repeated fields", () => {
    const headers = upstreamRequestHeaders(["X-Twice", "a", "x-twice", "b"], {
      target,
      bodyBytes: 7,
      gzip: true,
    })
    expect(headers["X-Twice"]).toEqual(["a", "b"])
    expect(headers["Content-Encoding"]).toBe("gzip")
  })
})

describe("clientResponseHeaders", () => {
  it("removes fields this hop owns and closes the connection", () => {
    const headers = clientResponseHeaders([
      "Connection",
      "keep-alive",
      "Transfer-Encoding",
      "chunked",
      "server",
      "fixture",
      "DATE",
      "yesterday",
      "Set-Cookie",
      "a=1",
      "Set-Cookie",
      "b=2",
      "Request-Id",
      "req_x",
    ])
    expect(headers).toEqual([
      "Set-Cookie",
      "a=1",
      "Set-Cookie",
      "b=2",
      "Request-Id",
      "req_x",
      "Connection",
      "close",
    ])
  })
})
