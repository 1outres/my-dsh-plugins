# dsh-serial-agent wire protocol, version 1

This is the contract between `dsh-serial-agent` (Go, `serial-agent/`) and the
serial gateway of `@1outres/dsh-plugin-remote` (TypeScript,
`packages/dsh-plugin-remote/src/host/serial/`). Both sides must follow this
file exactly. Change the protocol number when a change is not compatible.

## Transport

- The agent dials out. It opens a WebSocket to the Harness Web server at the
  gateway path, `/remote-serial/agent` by default (plugin config
  `serialGatewayPath`). Example: `wss://dsh.example.net/remote-serial/agent`.
- The agent must not send an `Origin` header. The gateway refuses an upgrade
  that has one (HTTP 403), so a web page cannot open the socket.
- Every message is one WebSocket **text** frame holding one JSON object. A
  frame is at most 1 MiB. Binary frames are a protocol error.
- Byte data (serial input and output) is standard base64 with padding.
- The gateway sends a WebSocket ping every 20 seconds. Either side closes the
  socket when it has received nothing (no frame, no pong) for 60 seconds.

## Close codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 1000 | Normal close.                                                 |
| 4400 | Protocol error (bad JSON, unknown type, wrong order).         |
| 4401 | Authentication failed (bad signature, wrong protocol number). |
| 4403 | The key is not in the gateway's `serialAgents` list.          |
| 4408 | The handshake did not finish within 10 seconds.               |
| 4409 | A newer connection with the same key replaced this one.       |

After 4401 or 4403 the agent waits at least 60 seconds before it tries again.
After any other close it reconnects with exponential backoff (1 s up to 30 s,
with jitter).

## Identity

Each agent has one Ed25519 key pair. The private key never leaves the agent
machine.

- **Public key text**: standard base64 of the 32 raw public key bytes. This is
  the `publicKey` value the user pastes into the plugin config
  `serialAgents: [{ name, publicKey }]`.
- **Fingerprint**: `SHA256:` followed by unpadded standard base64 of the
  SHA-256 digest of the 32 raw public key bytes (the same style as OpenSSH).

## Handshake

1. Gateway → agent:

   ```json
   { "type": "challenge", "protocol": 1, "nonce": "<base64 of 32 random bytes>" }
   ```

2. Agent → gateway:

   ```json
   {
     "type": "auth",
     "protocol": 1,
     "publicKey": "<public key text>",
     "signature": "<base64 Ed25519 signature>",
     "agent": { "version": "0.1.0", "hostname": "lab-mac", "os": "darwin", "arch": "arm64" }
   }
   ```

   The signature covers the UTF-8 bytes of
   `"dsh-serial-agent auth v1\n" + nonce`, where `nonce` is the base64 text
   exactly as received. `os` and `arch` are Go's `GOOS` and `GOARCH`.

3. The gateway checks the protocol number, then the key against
   `serialAgents`, then the signature. On success:

   ```json
   { "type": "welcome", "name": "<agent name from serialAgents>" }
   ```

   On failure it sends `{ "type": "rejected", "code": "...", "message": "..." }`
   and closes with the matching close code. `code` is one of
   `"protocol"` (4401), `"unknown-key"` (4403), `"bad-signature"` (4401).

If an agent with the same key is already connected, the gateway closes the
old socket with 4409 and keeps the new one.

No other message may be sent before `welcome`.

## Requests

After `welcome`, the gateway sends requests and the agent answers each one
exactly once. The agent may answer out of order.

```json
{ "type": "request", "id": 7, "method": "port.open", "params": { } }
{ "type": "response", "id": 7, "result": { } }
{ "type": "response", "id": 7, "error": { "code": "busy", "message": "..." } }
```

`id` is a positive integer chosen by the gateway, unique per connection.
A response has either `result` or `error`, never both. The gateway fails a
request that has no response after its request timeout (plugin config
`serialRequestTimeoutMs`).

Error codes:

| Code             | Meaning                                               |
| ---------------- | ----------------------------------------------------- |
| `invalid-params` | The params do not match this document.                |
| `unknown-method` | The agent does not know the method.                   |
| `not-allowed`    | The path does not match the agent's `allow` patterns. |
| `not-found`      | The path does not exist or is not a character device. |
| `busy`           | Another process holds the device.                     |
| `unknown-handle` | No open port has this handle.                         |
| `unsupported`    | The OS or driver cannot apply these settings.         |
| `io`             | Any other read, write, or ioctl failure.              |

### Shared shapes

```ts
type SerialSettings = {
  baudRate: number // positive integer
  dataBits: 5 | 6 | 7 | 8
  parity: "none" | "even" | "odd"
  stopBits: 1 | 2
  flowControl: "none" | "rtscts" | "xonxoff"
}

type PortInfo = {
  path: string
  description?: string
  usb?: {
    vendorId: string // 4 lowercase hex digits
    productId: string // 4 lowercase hex digits
    serialNumber?: string
    manufacturer?: string
    product?: string
  }
  open: boolean // whether the agent holds it open
  handle?: string // present when open
  settings?: SerialSettings // present when open
}
```

### `ports.list`

Params: `{}`. Result: `{ "ports": PortInfo[] }`.

Lists the devices that exist and match the agent's `allow` patterns, plus
every port the agent holds open. Sorted by `path`.

### `port.open`

Params: `{ "path": string, "settings": SerialSettings }`.

Result: `{ "handle": string, "reused": boolean, "start": number, "end": number }`.

Opens the device with exclusive access and applies the settings. If the agent
already holds this path open, it applies the new settings to the open port and
returns the same handle with `reused: true`; the output buffer is kept.

`start` and `end` are byte offsets in the port's output buffer: `start` is
the oldest byte still kept and `end` is one past the newest byte. Offsets
count every byte read from the device since the agent opened it, starting at
0, and never go back. The agent keeps the last `bufferBytes` bytes.

The path is checked with these rules, in order: clean it lexically, match it
against `allow` (`not-allowed`), resolve it and require a character device
(`not-found`). The handle is an opaque string such as `"p1"`.

### `port.subscribe`

Params: `{ "handle": string, "from": number }`.

Result: `{ "from": number, "lost": number }`.

Starts sending `data` events for this handle on this connection, beginning at
byte offset `from`. When `from` is older than `start`, the agent begins at
`start` and reports `lost = start - from`; otherwise `lost` is 0. When
`from` is past `end`, it begins at `end`. A second subscribe for the same
handle replaces the first. The buffered bytes are sent as `data` events
before the response, so every `data` event that follows the response is new.

### `port.unsubscribe`

Params: `{ "handle": string }`. Result: `{}`. Stops `data` events. The
port stays open.

### `port.write`

Params: `{ "handle": string, "data": base64 }`. Result: `{ "written": number }`.

Writes all bytes before it answers. `data` decodes to at most 64 KiB.

### `port.break`

Params: `{ "handle": string, "durationMs": number }`. Result: `{}`.

Holds the line in the BREAK state for `durationMs` (1 to 5000).

### `port.close`

Params: `{ "handle": string }`. Result: `{}`.

Closes the device and drops its buffer. The handle is invalid afterwards.

## Events

The agent sends events without a request:

```json
{ "type": "event", "event": "data", "handle": "p1", "offset": 1024, "data": "<base64>" }
{ "type": "event", "event": "closed", "handle": "p1", "reason": "device-removed", "message": "..." }
```

- `data`: bytes read from the device. `offset` is the offset of the first
  byte. Events for one handle are in order and do not overlap. One event
  carries at most 64 KiB.
- `closed`: the port closed without `port.close`. `reason` is
  `"device-removed"`, `"io-error"`, or `"orphan-timeout"`. `message` is an
  optional human-readable detail. The handle is invalid afterwards.

## Ports outlive connections

A port stays open in the agent when the WebSocket closes, and the agent keeps
reading into its buffer. This is what keeps console output while the Harness
restarts. A port with no subscriber closes by itself after `orphanTimeout`
(agent config, default one hour, 0 means never) and the agent logs it.

The gateway decides which Harness session may use a port. The agent trusts
the gateway and does not track sessions.
