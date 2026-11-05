import { once } from "node:events"
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import type { Relay } from "../../src/contract"

/** What the CLI really sent, before any rewrite of the relay. */
export interface TappedRequests {
  /** Bodies of `POST /v1/messages`, in order. */
  messages: Buffer[]
  /** Every other method and path, with the private route removed. */
  others: string[]
}

async function forward(
  relayUrl: string,
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
): Promise<void> {
  const { host: _host, ...headers } = request.headers
  const outgoing = httpRequest(`${relayUrl}${request.url}`, {
    method: request.method,
    headers,
    agent: false,
  })
  outgoing.on("error", () => response.destroy())
  response.once("close", () => outgoing.destroy())
  outgoing.end(body)
  const [answer] = (await once(outgoing, "response")) as [IncomingMessage]
  response.writeHead(answer.statusCode ?? 502, answer.headers)
  answer.on("error", () => response.destroy())
  answer.pipe(response)
}

function isMessagesRequest(request: IncomingMessage): boolean {
  return request.method === "POST" && request.url?.split("?")[0] === "/v1/messages"
}

/** A hop in front of a real relay, which shows the bytes the relay's rewrites start from. */
export async function tapRelay(relay: Relay, seen: TappedRequests): Promise<Relay> {
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const body = Buffer.concat(chunks)
      if (isMessagesRequest(request)) seen.messages.push(body)
      else seen.others.push(`${request.method} ${request.url}`)
      await forward(relay.url, request, response, body)
    })().catch(() => response.destroy())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    get used() {
      return relay.used
    },
    get denied() {
      return relay.denied
    },
    get status() {
      return relay.status
    },
    get failure() {
      return relay.failure
    },
    get requestId() {
      return relay.requestId
    },
    get retryAfterMs() {
      return relay.retryAfterMs
    },
    get unrestored() {
      return relay.unrestored
    },
    get capture() {
      return relay.capture
    },
    errorText: () => relay.errorText(),
    abort() {
      relay.abort()
      server.closeAllConnections()
    },
    async close() {
      await relay.close()
      server.close()
      server.closeAllConnections()
    },
  }
}
