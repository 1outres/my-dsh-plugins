import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface AskpassEnvironment {
  SSH_ASKPASS: string
  SSH_ASKPASS_REQUIRE: "force"
  DISPLAY: string
  DSH_REMOTE_ASKPASS_SOCKET: string
  DSH_REMOTE_ASKPASS_TOKEN: string
}

export type AskpassHandler = (prompt: string) => Promise<string>

const ASKPASS_SCRIPT = `#!__NODE__
const net = require("node:net")
const socketPath = process.env.DSH_REMOTE_ASKPASS_SOCKET
const token = process.env.DSH_REMOTE_ASKPASS_TOKEN
const prompt = process.argv[2] ?? ""
if (socketPath === undefined || token === undefined) process.exit(1)
const socket = net.connect(socketPath)
let buffer = ""
let sent = false
socket.setEncoding("utf8")
socket.on("connect", () => {
  socket.write(JSON.stringify({ token, prompt }) + "\\n")
  sent = true
})
socket.on("data", (chunk) => {
  buffer += chunk
  const end = buffer.indexOf("\\n")
  if (end === -1) return
  const text = buffer.slice(0, end)
  let response
  try {
    response = JSON.parse(text)
  } catch {
    process.exit(1)
  }
  if (typeof response.value === "string") process.stdout.write(response.value + "\\n")
  process.exit(0)
})
socket.on("error", () => process.exit(1))
socket.on("close", () => process.exit(sent ? 1 : 1))
`

/** One askpass socket shared by every connection of this host process. */
export class AskpassServer {
  readonly #dir: string
  readonly #socketPath: string
  readonly #server: Server
  readonly #handlers = new Map<string, AskpassHandler>()
  readonly #sockets = new Set<Socket>()

  private constructor(dir: string, socketPath: string, server: Server) {
    this.#dir = dir
    this.#socketPath = socketPath
    this.#server = server
    this.#server.on("connection", (socket) => {
      this.#sockets.add(socket)
      socket.setEncoding("utf8")
      socket.on("close", () => this.#sockets.delete(socket))
      socket.on("error", () => this.#sockets.delete(socket))
      let buffer = ""
      socket.on("data", (chunk: string) => {
        buffer += chunk
        const end = buffer.indexOf("\n")
        if (end === -1) return
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        void this.#reply(socket, line)
      })
    })
  }

  /** Private directory holding the socket and the askpass script. */
  get directory(): string {
    return this.#dir
  }

  static async create(nodePath = process.execPath): Promise<AskpassServer> {
    const dir = await mkdtemp(join(tmpdir(), "dsh-remote-"))
    const socketPath = join(dir, "askpass.sock")
    const scriptPath = join(dir, "askpass.js")
    await writeFile(scriptPath, ASKPASS_SCRIPT.replace("__NODE__", nodePath), { mode: 0o700 })
    await chmod(scriptPath, 0o700)
    const server = createServer()
    const askpass = new AskpassServer(dir, socketPath, server)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => {
        server.off("error", reject)
        resolve()
      })
    })
    return askpass
  }

  /** Register one connection's handler and return the environment ssh needs. */
  bind(token: string, handler: AskpassHandler): AskpassEnvironment {
    this.#handlers.set(token, handler)
    return {
      SSH_ASKPASS: join(this.#dir, "askpass.js"),
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: "dsh-remote",
      DSH_REMOTE_ASKPASS_SOCKET: this.#socketPath,
      DSH_REMOTE_ASKPASS_TOKEN: token,
    }
  }

  unbind(token: string): void {
    this.#handlers.delete(token)
  }

  async dispose(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
    this.#handlers.clear()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
    await rm(this.#dir, { recursive: true, force: true })
  }

  async #reply(socket: Socket, line: string): Promise<void> {
    let request: unknown
    try {
      request = JSON.parse(line)
    } catch {
      socket.end(`${JSON.stringify({ error: "bad request" })}\n`)
      return
    }
    const token = isRecord(request) ? request.token : undefined
    const prompt = isRecord(request) ? request.prompt : undefined
    if (typeof token !== "string" || typeof prompt !== "string") {
      socket.end(`${JSON.stringify({ error: "bad request" })}\n`)
      return
    }
    const handler = this.#handlers.get(token)
    if (handler === undefined) {
      socket.end(`${JSON.stringify({ error: "unknown connection" })}\n`)
      return
    }
    try {
      const value = await handler(prompt)
      socket.end(`${JSON.stringify({ value })}\n`)
    } catch (error) {
      socket.end(
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
      )
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
