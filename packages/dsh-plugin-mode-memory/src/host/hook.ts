import type { CreateInterceptor, SessionCreateRequest, SessionCreateValue } from "../contract"

const ORIGINAL = Symbol.for("cordis.original")

type CreateMethod = (this: unknown, request: SessionCreateRequest) => Promise<SessionCreateValue>

/**
 * Wrap `sessionController.create` on the raw service instance. The Remote
 * gateway resolves the service through a cordis Proxy, so the wrapper is an own
 * property of the object the proxy returns for `Symbol.for("cordis.original")`.
 * @param service - the service as the plugin context exposes it.
 * @param interceptor - the memory that decides the preset.
 * @returns a disposer that removes the wrapper when it is still ours.
 */
export function installCreateHook(service: object, interceptor: CreateInterceptor): () => void {
  const exposed = (service as Record<symbol, unknown>)[ORIGINAL]
  const original = (typeof exposed === "object" && exposed !== null ? exposed : service) as Record<
    string,
    unknown
  >
  const method = original.create
  if (typeof method !== "function") {
    throw new Error(
      "mode-memory: sessionController.create is not available; this DSH version is not supported",
    )
  }
  if (Object.hasOwn(original, "create")) {
    throw new Error("mode-memory: sessionController.create is already wrapped by another plugin")
  }

  const protoCreate = method as CreateMethod
  const wrapper = function (this: unknown, request: SessionCreateRequest) {
    return interceptor.intercept(request, (next) => protoCreate.call(this, next))
  }
  Object.defineProperty(original, "create", {
    value: wrapper,
    configurable: true,
    writable: true,
    enumerable: false,
  })

  return () => {
    if (original.create === wrapper) delete original.create
  }
}
