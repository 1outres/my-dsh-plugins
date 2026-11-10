import { offlineResponse } from "./offline"

/** Fetch a navigation request; it rejects when the network is gone. */
export type NavigationFetcher = (request: Request) => Promise<Response>

/**
 * Serve a navigation from the network, or with the offline page when the Host
 * cannot be reached. Only navigations come here: other requests are left to
 * the browser, and Harness assets are hashed and live.
 */
export async function serveNavigation(
  request: Request,
  fetcher: NavigationFetcher,
  language: string,
): Promise<Response> {
  try {
    return await fetcher(request)
  } catch {
    return offlineResponse(language)
  }
}
