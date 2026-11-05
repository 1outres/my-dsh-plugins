import { randomBytes, randomInt } from "node:crypto"
import { once } from "node:events"
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http"
import { isIP, connect as netConnect, type Socket } from "node:net"
import { type TLSSocket, connect as tlsConnect } from "node:tls"
import { promisify } from "node:util"
import { gzip } from "node:zlib"
import type { Env } from "../contract"
import { FailureCode, NativeFailure } from "../errors"

/**
 * Longest silence on a response body before the stream counts as dead. It matches
 * the CLI's own byte watchdog against the Anthropic API.
 */
export const UPSTREAM_IDLE_LIMIT_MS = 180_000
/** Probes a quiet upstream socket, so a dead path fails soon and not after TCP retransmits. */
const KEEPALIVE_INITIAL_DELAY_MS = 15_000
const GZIP_MIN_BYTES = 4096
const GZIP_MAX_PAD_BYTES = 256
const GZIP_OFF_VALUES: ReadonlySet<string> = new Set(["0", "false", "no", "off"])
const CUSTOM_CA_VARIABLES = [
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
] as const

const REQUEST_FIELDS_OWNED_BY_THIS_HOP: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "proxy-authorization",
  "proxy-connection",
  "accept-encoding",
])
const RESPONSE_FIELDS_OWNED_BY_THIS_HOP: ReadonlySet<string> = new Set([
  "connection",
  "transfer-encoding",
  "server",
  "date",
])

const INVALID_UPSTREAM = "Native upstream must be HTTPS or a loopback HTTP fixture"
const UNSUPPORTED_PROXY =
  "Unusable proxy for the relay: only an http://host[:port] CONNECT proxy is supported, not SOCKS or TLS to the proxy"

/** Fixed facts about where the relay connects. Tests replace them to use loopback peers. */
export interface UpstreamPolicy {
  /** Origins that accept a gzip request body. */
  gzipOrigins: readonly string[]
  /** Extra TLS trust. Certificate checks always stay on. */
  tls: { ca?: string }
}

export const DEFAULT_UPSTREAM_POLICY: UpstreamPolicy = {
  gzipOrigins: ["https://api.anthropic.com"],
  tls: {},
}

export interface UpstreamTarget {
  secure: boolean
  origin: string
  /** Name to connect to and to check the certificate against. IPv6 has no brackets. */
  hostname: string
  port: number
  /** Value for the `Host` header. */
  host: string
  /** Value for a `CONNECT` request line. */
  tunnelAuthority: string
  /** URL path with no trailing slash. */
  basePath: string
}

export interface ProxyRoute {
  host: string
  port: number
  /** Value for `Proxy-Authorization`. */
  authorization?: string
}

/** A failure the relay itself detects. Its name is safe to report. */
export class LocalFailure extends Error {
  constructor(name: string) {
    super(name)
    this.name = name
  }
}

export function idleLimitMs(timeoutMs: number): number {
  return Math.min(timeoutMs, UPSTREAM_IDLE_LIMIT_MS)
}

function parseUrl(raw: string): URL | null {
  return URL.canParse(raw) ? new URL(raw) : null
}

function withoutBrackets(hostname: string): string {
  return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname
}

function isLoopback(hostname: string): boolean {
  if (hostname === "localhost") return true
  const version = isIP(hostname)
  if (version === 4) return hostname.startsWith("127.")
  return version === 6 && hostname === "::1"
}

function hasOnlySchemeHostAndPath(url: URL): boolean {
  return url.username === "" && url.password === "" && url.search === "" && url.hash === ""
}

/** Accepts HTTPS, or HTTP on loopback for test fixtures. The error never quotes the URL. */
export function parseUpstreamUrl(raw: string): UpstreamTarget {
  const url = parseUrl(raw)
  if (url === null || !hasOnlySchemeHostAndPath(url)) {
    throw new NativeFailure(INVALID_UPSTREAM, FailureCode.relayError)
  }
  const hostname = withoutBrackets(url.hostname)
  const secure = url.protocol === "https:"
  if (!secure && !(url.protocol === "http:" && isLoopback(hostname))) {
    throw new NativeFailure(INVALID_UPSTREAM, FailureCode.relayError)
  }
  const port = url.port === "" ? (secure ? 443 : 80) : Number(url.port)
  return {
    secure,
    origin: url.origin,
    hostname,
    port,
    host: url.host,
    tunnelAuthority: `${url.hostname}:${port}`,
    basePath: url.pathname.replace(/\/+$/, ""),
  }
}

/** Reads `*_proxy` variables. A lowercase variable wins, and an empty one removes the entry. */
function proxyVariables(env: Env): ReadonlyMap<string, string> {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      entry[0].length > 6 &&
      entry[0].slice(-6).toLowerCase() === "_proxy",
  )
  const proxies = new Map<string, string>()
  for (const [name, value] of entries) {
    if (value !== "") proxies.set(name.slice(0, -6).toLowerCase(), value)
  }
  // CVE-2016-1000110: in a CGI process, HTTP_PROXY can come from a client's "Proxy:" header.
  if (env.REQUEST_METHOD !== undefined) proxies.delete("http")
  for (const [name, value] of entries) {
    if (!name.endsWith("_proxy")) continue
    const key = name.slice(0, -6).toLowerCase()
    if (value === "") proxies.delete(key)
    else proxies.set(key, value)
  }
  return proxies
}

function bypassesProxy(target: UpstreamTarget, noProxy: string | undefined): boolean {
  if (noProxy === undefined) return false
  // The CLI also accepts entries separated by spaces.
  const list = noProxy.replaceAll(" ", ",")
  if (list === "*") return true
  const hostname = target.hostname.toLowerCase()
  const hostAndPort = `${hostname}:${target.port}`
  return list
    .split(",")
    .map((entry) => entry.trim().replace(/^\.+/, "").toLowerCase())
    .filter((name) => name !== "")
    .some(
      (name) =>
        hostname === name ||
        hostAndPort === name ||
        hostname.endsWith(`.${name}`) ||
        hostAndPort.endsWith(`.${name}`),
    )
}

/** `decodeURIComponent` throws on a stray percent sign, which is legal in a raw proxy password. */
function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) =>
    Buffer.from(run.replaceAll("%", ""), "hex").toString("utf8"),
  )
}

function proxyAuthorization(proxy: URL): string | undefined {
  if (proxy.username === "" && proxy.password === "") return undefined
  const credentials = `${percentDecode(proxy.username)}:${percentDecode(proxy.password)}`
  return `Basic ${Buffer.from(credentials).toString("base64")}`
}

function parseProxy(raw: string): ProxyRoute {
  const url = parseUrl(raw.includes("://") ? raw : `http://${raw}`)
  if (url === null || url.protocol !== "http:" || url.hostname === "") {
    throw new NativeFailure(UNSUPPORTED_PROXY, FailureCode.relayError)
  }
  const authorization = proxyAuthorization(url)
  return {
    host: withoutBrackets(url.hostname),
    port: url.port === "" ? 80 : Number(url.port),
    ...(authorization === undefined ? {} : { authorization }),
  }
}

/**
 * The HTTP CONNECT proxy for the target, or null. The relay opens the upstream
 * connection itself, so the CLI's own proxy handling never runs. The same
 * variables apply here. A proxy is only a tunnel: TLS still ends at the upstream.
 */
export function selectProxy(target: UpstreamTarget, env: Env): ProxyRoute | null {
  if (!target.secure) return null
  const proxies = proxyVariables(env)
  if (bypassesProxy(target, proxies.get("no"))) return null
  const raw = proxies.get("https") ?? proxies.get("http")
  return raw === undefined ? null : parseProxy(raw)
}

export interface GzipFacts {
  target: UpstreamTarget
  proxy: ProxyRoute | null
  env: Env
  gzipOrigins: readonly string[]
  payloadBytes: number
  contentEncoding: string | undefined
}

export function gzipEligible(facts: GzipFacts): boolean {
  const setting = facts.env.CLAUDE_CODE_GZIP_REQUEST_BODIES?.toLowerCase() ?? ""
  return (
    facts.gzipOrigins.includes(facts.target.origin) &&
    facts.proxy === null &&
    CUSTOM_CA_VARIABLES.every((name) => facts.env[name] === undefined) &&
    !GZIP_OFF_VALUES.has(setting) &&
    facts.payloadBytes >= GZIP_MIN_BYTES &&
    facts.contentEncoding === undefined
  )
}

function gzipPadding(padBytes: number): Buffer {
  const noise = randomBytes(padBytes)
  const pad = Buffer.alloc(padBytes + 1)
  pad[0] = 0x0a
  noise.forEach((byte, index) => {
    pad[index + 1] = byte % 2 === 0 ? 0x20 : 0x09
  })
  return pad
}

const gzipAsync = promisify(gzip)

/** Compresses off the main thread, because this runs inside the host process. */
export async function gzipRequestBody(
  payload: Buffer,
  padBytes = randomInt(GZIP_MAX_PAD_BYTES + 1),
): Promise<Buffer> {
  return gzipAsync(Buffer.concat([payload, gzipPadding(padBytes)]), { level: 3 })
}

function rawHeaderPairs(rawHeaders: readonly string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    pairs.push([rawHeaders[index] as string, rawHeaders[index + 1] as string])
  }
  return pairs
}

export interface UpstreamBodyFacts {
  target: UpstreamTarget
  bodyBytes: number
  gzip: boolean
}

/** Request identity stays as the CLI built it. Only the transfer fields change. */
export function upstreamRequestHeaders(
  rawHeaders: readonly string[],
  facts: UpstreamBodyFacts,
): OutgoingHttpHeaders {
  const fields = new Map<string, { name: string; values: string[] }>()
  for (const [name, value] of rawHeaderPairs(rawHeaders)) {
    const key = name.toLowerCase()
    if (REQUEST_FIELDS_OWNED_BY_THIS_HOP.has(key)) continue
    const field = fields.get(key)
    if (field === undefined) fields.set(key, { name, values: [value] })
    else field.values.push(value)
  }
  const headers: OutgoingHttpHeaders = {}
  for (const { name, values } of fields.values()) {
    headers[name] = values.length === 1 ? values[0] : values
  }
  headers.Host = facts.target.host
  headers["Accept-Encoding"] = "identity"
  headers["Content-Length"] = String(facts.bodyBytes)
  if (facts.gzip) headers["Content-Encoding"] = "gzip"
  return headers
}

export function clientResponseHeaders(rawHeaders: readonly string[]): string[] {
  const kept = rawHeaderPairs(rawHeaders).filter(
    ([name]) => !RESPONSE_FIELDS_OWNED_BY_THIS_HOP.has(name.toLowerCase()),
  )
  return [...kept.flat(), "Connection", "close"]
}

function ignoreError(): void {}

/**
 * Every socket of a call ends with the call, and a socket error ends the call. An
 * unheard socket error would crash the host. Node also reports a reset as a clean
 * end of a stream with no length, so the response stream alone cannot show it.
 */
function tieToCall(socket: Socket, control: AbortController): void {
  socket.on("error", (error) => control.abort(error))
  control.signal.addEventListener("abort", () => socket.destroy(), { once: true })
}

async function openTcp(host: string, port: number, control: AbortController): Promise<Socket> {
  const socket = netConnect({ host, port })
  tieToCall(socket, control)
  socket.setKeepAlive(true, KEEPALIVE_INITIAL_DELAY_MS)
  await once(socket, "connect", { signal: control.signal })
  return socket
}

async function openTunnel(
  socket: Socket,
  proxy: ProxyRoute,
  target: UpstreamTarget,
  signal: AbortSignal,
): Promise<Socket> {
  const request = httpRequest({
    method: "CONNECT",
    path: target.tunnelAuthority,
    headers: {
      Host: target.tunnelAuthority,
      // Without an agent Node sends "close", which is wrong for a tunnel that must stay open.
      Connection: "keep-alive",
      ...(proxy.authorization === undefined ? {} : { "Proxy-Authorization": proxy.authorization }),
    },
    createConnection: () => socket,
  })
  request.on("error", ignoreError)
  request.end()
  const [response, tunnel, head] = (await once(request, "connect", { signal })) as [
    IncomingMessage,
    Socket,
    Buffer,
  ]
  if (response.statusCode !== 200) throw new LocalFailure("ProxyTunnelRefused")
  if (head.length > 0) tunnel.unshift(head)
  return tunnel
}

async function startTls(
  socket: Socket,
  route: UpstreamRoute,
  control: AbortController,
): Promise<TLSSocket> {
  const { hostname } = route.target
  const secure = tlsConnect({
    socket,
    host: hostname,
    // TLS does not allow an IP address as a server name.
    ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
    ALPNProtocols: ["http/1.1"],
    ...route.tls,
  })
  tieToCall(secure, control)
  await once(secure, "secureConnect", { signal: control.signal })
  return secure
}

async function connectToUpstream(route: UpstreamRoute, control: AbortController): Promise<Socket> {
  const deadline = setTimeout(
    () => control.abort(new LocalFailure("UpstreamTimeout")),
    route.timeoutMs,
  )
  try {
    const { proxy, target } = route
    const first =
      proxy === null
        ? await openTcp(target.hostname, target.port, control)
        : await openTcp(proxy.host, proxy.port, control)
    const path = proxy === null ? first : await openTunnel(first, proxy, target, control.signal)
    return target.secure ? await startTls(path, route, control) : path
  } finally {
    clearTimeout(deadline)
  }
}

/** Ends the call when its socket stays quiet for too long. */
export class SilenceLimit {
  readonly #socket: Socket
  #limitMs = 0
  #failure = ""

  constructor(socket: Socket, control: AbortController) {
    this.#socket = socket
    socket.on("timeout", () => control.abort(new LocalFailure(this.#failure)))
  }

  start(limitMs: number, failure: string): void {
    this.#limitMs = limitMs
    this.#failure = failure
    this.resume()
  }

  /** While the client holds back the stream, upstream silence means nothing. */
  suspend(): void {
    this.#socket.setTimeout(0)
  }

  resume(): void {
    // A timer set on a closed socket would still fire later.
    if (!this.#socket.destroyed) this.#socket.setTimeout(this.#limitMs)
  }
}

export interface UpstreamRoute {
  target: UpstreamTarget
  proxy: ProxyRoute | null
  tls: UpstreamPolicy["tls"]
  timeoutMs: number
}

export interface UpstreamRequest {
  path: string
  headers: OutgoingHttpHeaders
  body: Buffer
}

export interface UpstreamCall {
  readonly response: IncomingMessage
  readonly silence: SilenceLimit
}

async function exchangeHeaders(
  socket: Socket,
  upstream: UpstreamRequest,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  // No agent: each call owns one socket, and nothing from a call stays in a pool.
  const request = httpRequest({
    method: "POST",
    path: upstream.path,
    headers: upstream.headers,
    createConnection: () => socket,
  })
  request.on("error", ignoreError)
  request.end(upstream.body)
  const [response] = (await once(request, "response", { signal })) as [IncomingMessage]
  response.on("error", ignoreError)
  return response
}

/**
 * Sends one request and waits for the response headers. The whole call ends when
 * `control` aborts. A caller aborts it to release the sockets when it is done.
 */
export async function openUpstream(
  route: UpstreamRoute,
  upstream: UpstreamRequest,
  control: AbortController,
): Promise<UpstreamCall> {
  control.signal.throwIfAborted()
  const socket = await connectToUpstream(route, control)
  const silence = new SilenceLimit(socket, control)
  silence.start(route.timeoutMs, "UpstreamTimeout")
  const response = await exchangeHeaders(socket, upstream, control.signal)
  silence.start(idleLimitMs(route.timeoutMs), "UpstreamIdle")
  return { response, silence }
}
