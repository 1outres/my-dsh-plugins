import type {
  CapturedMessage,
  CreateRelay,
  Relay,
  RelayOptions,
  StreamCapture,
} from "../../src/contract"

export const FAKE_RELAY_URL = "http://127.0.0.1:1/fake-private-route"

export interface FakeRelayState {
  used: boolean
  denied: number
  status: number | null
  failure: string | null
  requestId: string | null
  retryAfterMs: number | null
  unrestored: string | null
  message: CapturedMessage | null
  complete: boolean
  error: StreamCapture["error"]
  errorText: string
}

export interface FakeRelay extends Relay {
  readonly aborted: boolean
  readonly closed: boolean
}

export interface FakeRelayControl {
  create: CreateRelay
  readonly created: readonly FakeRelay[]
  readonly options: readonly RelayOptions[]
  /** The relay of the most recent call. */
  last(): FakeRelay
}

export function capturedMessage(overrides: Partial<CapturedMessage> = {}): CapturedMessage {
  return {
    id: "msg_captured",
    role: "assistant",
    content: [{ type: "text", text: "FIRST" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 3, output_tokens: 2 },
    ...overrides,
  }
}

const UNUSED: FakeRelayState = {
  used: false,
  denied: 0,
  status: null,
  failure: null,
  requestId: null,
  retryAfterMs: null,
  unrestored: null,
  message: null,
  complete: false,
  error: null,
  errorText: "",
}

/** A relay that took one clean upstream answer. */
export const CLEAN_RELAY: Partial<FakeRelayState> = {
  used: true,
  status: 200,
  requestId: "req_fixture",
  message: capturedMessage(),
  complete: true,
}

function fakeRelay(state: FakeRelayState): FakeRelay {
  const capture: StreamCapture = {
    message: state.message,
    complete: state.complete,
    error: state.error,
    feed() {},
  }
  let aborted = false
  let closed = false
  return {
    url: FAKE_RELAY_URL,
    used: state.used,
    denied: state.denied,
    status: state.status,
    failure: state.failure,
    requestId: state.requestId,
    retryAfterMs: state.retryAfterMs,
    unrestored: state.unrestored,
    capture,
    get aborted() {
      return aborted
    },
    get closed() {
      return closed
    },
    errorText: () => state.errorText,
    abort() {
      aborted = true
    },
    async close() {
      aborted = true
      closed = true
    },
  }
}

export function fakeRelayControl(state: Partial<FakeRelayState> = {}): FakeRelayControl {
  const created: FakeRelay[] = []
  const options: RelayOptions[] = []
  return {
    created,
    options,
    last() {
      const relay = created.at(-1)
      if (relay === undefined) throw new Error("no relay was created")
      return relay
    },
    async create(relayOptions) {
      options.push(relayOptions)
      const relay = fakeRelay({ ...UNUSED, ...state })
      created.push(relay)
      return relay
    },
  }
}
