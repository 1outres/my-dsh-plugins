import { describe, expect, it } from "vitest"
import type {
  CreateInterceptor,
  CreateSession,
  SessionCreateRequest,
  SessionCreateValue,
} from "../src/contract"
import { installCreateHook } from "../src/host/hook"

const ORIGINAL = Symbol.for("cordis.original")

class Controller {
  readonly seen: SessionCreateRequest[] = []

  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    this.seen.push(request)
    return { sessionId: "s-original", agentPreset: request.agentPreset }
  }
}

class Tagged {
  constructor(readonly tag: string) {}

  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return { sessionId: this.tag, agentPreset: request.agentPreset }
  }
}

function replacePreset(): CreateInterceptor {
  return {
    intercept: async (request, create) => create({ ...request, agentPreset: "cordis" }),
  }
}

describe("installCreateHook", () => {
  it("wraps the prototype method on an instance", async () => {
    const controller = new Controller()
    const dispose = installCreateHook(controller, replacePreset())
    const descriptor = Object.getOwnPropertyDescriptor(controller, "create")
    expect(descriptor?.enumerable).toBe(false)
    expect(descriptor?.configurable).toBe(true)
    expect(descriptor?.writable).toBe(true)

    const result = await controller.create({ cwd: "/work/repo" })
    expect(result).toEqual({ sessionId: "s-original", agentPreset: "cordis" })
    expect(controller.seen).toEqual([{ cwd: "/work/repo", agentPreset: "cordis" }])

    dispose()
    expect(Object.hasOwn(controller, "create")).toBe(false)
  })

  it("forwards this to the original method", async () => {
    const controller = new Tagged("tagged")
    const dispose = installCreateHook(controller, {
      intercept: async (request, create) => create(request),
    })
    const result = await controller.create({})
    expect(result.sessionId).toBe("tagged")
    dispose()
  })

  it("installs through a cordis proxy", async () => {
    const controller = new Controller()
    const proxy = new Proxy(controller, {
      get(target, property, receiver) {
        if (property === ORIGINAL) return target
        return Reflect.get(target, property, receiver)
      },
    })
    const dispose = installCreateHook(proxy, replacePreset())
    const wrapped = Reflect.get(proxy, "create") as CreateSession
    expect(wrapped).not.toBe(Controller.prototype.create)

    const result = await Reflect.apply(wrapped, controller, [{ cwd: "/work/repo" }])
    expect(result.agentPreset).toBe("cordis")
    expect(controller.seen).toHaveLength(1)

    dispose()
    expect(Object.hasOwn(controller, "create")).toBe(false)
  })

  it("refuses a service without a create method", () => {
    expect(() => installCreateHook({}, replacePreset())).toThrow(
      "mode-memory: sessionController.create is not available; this DSH version is not supported",
    )
    expect(() => installCreateHook({ create: 1 }, replacePreset())).toThrow(
      "mode-memory: sessionController.create is not available; this DSH version is not supported",
    )
  })

  it("refuses a second wrap", () => {
    const controller = new Controller()
    const dispose = installCreateHook(controller, replacePreset())
    expect(() => installCreateHook(controller, replacePreset())).toThrow(
      "mode-memory: sessionController.create is already wrapped by another plugin",
    )
    dispose()
  })

  it("restores the prototype method on dispose", () => {
    const controller = new Controller()
    const dispose = installCreateHook(controller, replacePreset())
    expect(controller.create).not.toBe(Controller.prototype.create)
    dispose()
    expect(controller.create).toBe(Controller.prototype.create)
  })

  it("leaves a foreign wrapper alone on dispose", () => {
    const controller = new Controller()
    const dispose = installCreateHook(controller, replacePreset())
    const foreign = async (): Promise<SessionCreateValue> => ({ sessionId: "foreign" })
    controller.create = foreign
    dispose()
    expect(controller.create).toBe(foreign)
    expect(Object.hasOwn(controller, "create")).toBe(true)
  })
})
