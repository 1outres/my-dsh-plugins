import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment"
import { ClaudeSubscriptionAdapter } from "../../src/adapter"
import type { CreateRelay, Env, NativeDeps, Relay, RelayOptions } from "../../src/contract"
import { runNative } from "../../src/native/run"
import { discoverModels } from "../../src/native/setup"
import { createRelay } from "../../src/relay/relay"
import { type ImageAccess, imageRequestTarget } from "../../src/request/images"
import { modelInfo } from "../../src/request/model-info"
import { type AttachmentReader, prepareRequest } from "../../src/request/prepare"
import { projectionOf } from "../../src/request/replay"
import { type LocalSubprocess, localSubprocess } from "../../test/support/local-subprocess"
import { Peer } from "./peer"
import { type TappedRequests, tapRelay } from "./tap"

const FAKE_API_KEY = "sk-ant-eval-fixture-not-a-real-key"
const REAL_UPSTREAM = "https://api.anthropic.com"
const INERT_MCP = fileURLToPath(new URL("../../src/standalone/inert-mcp.ts", import.meta.url))
// Anything the CLI tries outside loopback meets a dead proxy, so it can never reach a real service.
const DEAD_PROXY = "http://127.0.0.1:1"
const PROXY_VARIABLES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const

export const FIXTURE_API_KEY = FAKE_API_KEY

export interface RigOptions {
  binary: string
  /** Puts a recording hop before the relay, to see what the CLI sent before any rewrite. */
  tap?: boolean
  attachments?: AttachmentReader
  imageAccess?: (ref: ImageAttachmentRef) => ImageAccess | undefined
  /** More variables for the CLI, for a probe of what one of its switches does. */
  childEnv?: NodeJS.ProcessEnv
  readIdleTimeoutSeconds?: number
}

export interface Rig {
  readonly adapter: ClaudeSubscriptionAdapter
  readonly peer: Peer
  readonly subprocess: LocalSubprocess
  /** One entry per relay, with what the plugin asked of it. */
  readonly relays: { options: RelayOptions; relay: Relay }[]
  readonly tapped: TappedRequests
  /** Warnings the adapter gave to the DSH logger. */
  readonly warnings: string[]
  /** Everything the CLIs wrote to stdout, in pieces. */
  readonly cliOutput: string[]
  /** The temp dir of the plugin and the CLI. */
  readonly tmp: string
  close(): Promise<void>
}

function ambientEnv(root: string, tmp: string): Env {
  const proxies = Object.fromEntries(PROXY_VARIABLES.map((name) => [name, DEAD_PROXY]))
  return {
    PATH: process.env.PATH,
    HOME: root,
    XDG_CONFIG_HOME: root,
    TMPDIR: tmp,
    USER: "eval",
    LOGNAME: "eval",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    ...proxies,
  }
}

function assertIsolated(env: NodeJS.ProcessEnv, root: string): void {
  const configDir = env.CLAUDE_CONFIG_DIR ?? ""
  if (!configDir.startsWith(`${root}${sep}`)) {
    throw new Error("The eval refuses to start the CLI with a config dir outside its temp root")
  }
  if (!env.ANTHROPIC_BASE_URL?.startsWith("http://127.0.0.1:")) {
    throw new Error("The eval refuses to start the CLI with a base URL outside loopback")
  }
}

/** The real subprocess seam, plus the fake key the plugin itself would never pass on. */
function subprocessWithFakeKey(
  subprocess: LocalSubprocess,
  root: string,
  output: string[],
  childEnv: NodeJS.ProcessEnv,
): LocalSubprocess {
  return {
    get spawned() {
      return subprocess.spawned
    },
    spawn(spec) {
      const env = { ...spec.env, ...childEnv, ANTHROPIC_API_KEY: FAKE_API_KEY }
      assertIsolated(env, root)
      const handle = subprocess.spawn({ ...spec, env })
      handle.stdout?.on("data", (chunk: unknown) => output.push(String(chunk)))
      return handle
    },
    resolveExecutable: (command, env, signal) => subprocess.resolveExecutable(command, env, signal),
    terminateAll: () => subprocess.terminateAll(),
  }
}

/** One temp root, one synthetic peer, and the real plugin code around the real CLI. */
export async function openRig(options: RigOptions): Promise<Rig> {
  if (!isAbsolute(options.binary)) throw new Error("The CLI path must be absolute")
  const root = mkdtempSync(join(tmpdir(), "claude-subscription-eval-"))
  const tmp = join(root, "tmp")
  mkdirSync(tmp, { mode: 0o700 })
  const previousTmp = process.env.TMPDIR
  // `sharedWorkdir` and the per-request files read this, so they stay inside the temp root too.
  process.env.TMPDIR = tmp

  const peer = new Peer()
  await peer.listen()
  const ambient = ambientEnv(root, tmp)
  const cliOutput: string[] = []
  const subprocess = subprocessWithFakeKey(
    localSubprocess(ambient),
    root,
    cliOutput,
    options.childEnv ?? {},
  )
  const relays: Rig["relays"] = []
  const tapped: TappedRequests = { messages: [], others: [] }
  const warnings: string[] = []

  const relayOnPeer: CreateRelay = async (relayOptions) => {
    if (relayOptions.upstream !== REAL_UPSTREAM) {
      throw new Error(`The plugin asked for an unexpected upstream: ${relayOptions.upstream}`)
    }
    const real = await createRelay({ ...relayOptions, upstream: peer.url })
    const relay = options.tap === true ? await tapRelay(real, tapped) : real
    relays.push({ options: relayOptions, relay })
    return relay
  }

  const native: NativeDeps = {
    subprocess,
    createRelay: relayOnPeer,
    settings: () => ({
      command: options.binary,
      claudeConfigDir: join(root, "config"),
      // On, the CLI would try its feature-flag fetch. The dead proxy would stop it, but this
      // leaves nothing to stop.
      claudeCodeTelemetry: false,
      readIdleTimeoutSeconds: options.readIdleTimeoutSeconds ?? 45,
    }),
    processEnv: () => ambient,
    inertMcpPath: INERT_MCP,
    nodePath: process.execPath,
  }
  const adapter = new ClaudeSubscriptionAdapter({
    prepare: (request) =>
      prepareRequest(request, {
        attachments: () => options.attachments,
        imageAccess: options.imageAccess ?? (() => undefined),
      }),
    run: runNative,
    discover: discoverModels,
    modelInfo,
    imageTarget: imageRequestTarget,
    projectionOf,
    native,
    reportDiscovery: () => {},
    warn: (message) => warnings.push(message),
  })

  return {
    adapter,
    peer,
    subprocess,
    relays,
    tapped,
    warnings,
    cliOutput,
    tmp,
    async close() {
      await subprocess.terminateAll()
      await Promise.all(relays.map(({ relay }) => relay.close().catch(() => {})))
      await peer.close()
      if (previousTmp === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previousTmp
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Per-request directories the plugin left behind. The CLI keeps its own entries here too. */
export function strayRequestDirectories(tmp: string): string[] {
  return readdirSync(tmp).filter(
    (name) =>
      name.startsWith("claude-subscription-") && !name.startsWith("claude-subscription-cwd-"),
  )
}

export interface BinaryReceipt {
  version: string
  sha256: string
}

/** The version comes from a throwaway home, so it reads no real configuration. */
export function binaryReceipt(binary: string): BinaryReceipt {
  const home = mkdtempSync(join(tmpdir(), "claude-subscription-eval-version-"))
  try {
    const version = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: home,
        CLAUDE_CONFIG_DIR: home,
        HTTP_PROXY: DEAD_PROXY,
        HTTPS_PROXY: DEAD_PROXY,
      },
    }).trim()
    return { version, sha256: createHash("sha256").update(readFileSync(binary)).digest("hex") }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
