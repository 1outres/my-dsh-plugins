import { WORKER_SCRIPT_PATH } from "../worker/protocol"

/** One exact-path route answered by a Fetch resource. */
export interface WebResourceRoute {
  kind: "exact"
  path: string
  resource: (request: Request) => Promise<Response>
}

/** The slice of `ctx.webServer` the Host half uses. */
export interface WebServerLike {
  register(route: WebResourceRoute): () => void
}

export const WORKER_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "no-cache",
  "Service-Worker-Allowed": "/",
}

function workerBody(script: Uint8Array | string): BodyInit {
  return typeof script === "string" ? script : new Uint8Array(script).buffer
}

/**
 * Serve the worker script at the site root. The route only serves the file:
 * whether the browser registers it is the browser half's setting.
 */
export function createWorkerRoute(script: Uint8Array | string): WebResourceRoute {
  const body = workerBody(script)
  return {
    kind: "exact",
    path: WORKER_SCRIPT_PATH,
    resource: async () => new Response(body, { headers: WORKER_HEADERS }),
  }
}
