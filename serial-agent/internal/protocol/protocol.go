// Package protocol defines the wire contract with the Harness serial
// gateway. See PROTOCOL.md in the repository root of this module.
package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Version is the protocol number both sides must agree on.
const Version = 1

// Limits from PROTOCOL.md.
const (
	MaxFrameBytes = 1 << 20
	MaxDataBytes  = 64 << 10
	MaxWriteBytes = 64 << 10
	MinBreakMs    = 1
	MaxBreakMs    = 5000
)

// Error codes the agent sends in a response.
const (
	CodeInvalidParams = "invalid-params"
	CodeUnknownMethod = "unknown-method"
	CodeNotAllowed    = "not-allowed"
	CodeNotFound      = "not-found"
	CodeBusy          = "busy"
	CodeUnknownHandle = "unknown-handle"
	CodeUnsupported   = "unsupported"
	CodeIO            = "io"
)

// Error is a request failure the gateway shows to the model.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Errorf builds a protocol error.
func Errorf(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

// Message is one decoded WebSocket text frame.
type Message interface {
	messageType() string
}

type AgentInfo struct {
	Version  string `json:"version"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

type Challenge struct {
	Type     string `json:"type"`
	Protocol int    `json:"protocol"`
	Nonce    string `json:"nonce"`
}

func (*Challenge) messageType() string { return "challenge" }

type Auth struct {
	Type      string    `json:"type"`
	Protocol  int       `json:"protocol"`
	PublicKey string    `json:"publicKey"`
	Signature string    `json:"signature"`
	Agent     AgentInfo `json:"agent"`
}

func NewAuth(publicKey, signature string, agent AgentInfo) Auth {
	return Auth{Type: "auth", Protocol: Version, PublicKey: publicKey, Signature: signature, Agent: agent}
}

func (*Auth) messageType() string { return "auth" }

type Welcome struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

func (*Welcome) messageType() string { return "welcome" }

type Rejected struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (*Rejected) messageType() string { return "rejected" }

type Request struct {
	Type   string          `json:"type"`
	ID     int64           `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func (*Request) messageType() string { return "request" }

// NewRequest encodes a request. It is meant for tests and the fake gateway.
func NewRequest(id int64, method string, params any) ([]byte, error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("marshal params of %s: %w", method, err)
	}
	return json.Marshal(Request{Type: "request", ID: id, Method: method, Params: raw})
}

// DecodeParams decodes request params and rejects unknown fields.
func DecodeParams(raw json.RawMessage, dst any) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return errors.New("params are missing")
	}
	if trimmed[0] != '{' {
		return errors.New("params must be a JSON object")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("params have trailing data")
	}
	return nil
}

// Response is a reply to one request. It carries exactly one of Result and
// Error.
type Response struct {
	Type   string          `json:"type"`
	ID     int64           `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Error          `json:"error,omitempty"`
}

// NewResultResponse builds a successful response.
func NewResultResponse(id int64, result any) (Response, error) {
	raw, err := json.Marshal(result)
	if err != nil {
		return Response{}, fmt.Errorf("marshal result of request %d: %w", id, err)
	}
	return Response{Type: "response", ID: id, Result: raw}, nil
}

// NewErrorResponse builds a failed response.
func NewErrorResponse(id int64, code, message string) Response {
	return Response{Type: "response", ID: id, Error: &Error{Code: code, Message: message}}
}

func (*Response) messageType() string { return "response" }

// MarshalJSON refuses a response that carries both a result and an error or
// neither of them.
func (r Response) MarshalJSON() ([]byte, error) {
	hasResult := len(r.Result) > 0
	if hasResult == (r.Error != nil) {
		return nil, errors.New("protocol: response must have exactly one of result and error")
	}
	type wire Response
	return json.Marshal(wire(r))
}

type DataEvent struct {
	Type   string `json:"type"`
	Event  string `json:"event"`
	Handle string `json:"handle"`
	Offset int64  `json:"offset"`
	Data   []byte `json:"data"`
}

func NewDataEvent(handle string, offset int64, data []byte) DataEvent {
	return DataEvent{Type: "event", Event: "data", Handle: handle, Offset: offset, Data: data}
}

func (*DataEvent) messageType() string { return "event" }

type ClosedEvent struct {
	Type    string `json:"type"`
	Event   string `json:"event"`
	Handle  string `json:"handle"`
	Reason  string `json:"reason"`
	Message string `json:"message,omitempty"`
}

// Reasons carried by a closed event.
const (
	ReasonDeviceRemoved = "device-removed"
	ReasonIOError       = "io-error"
	ReasonOrphanTimeout = "orphan-timeout"
)

func NewClosedEvent(handle, reason, message string) ClosedEvent {
	return ClosedEvent{Type: "event", Event: "closed", Handle: handle, Reason: reason, Message: message}
}

func (*ClosedEvent) messageType() string { return "event" }

// Encode marshals one message for a text frame.
func Encode(v any) ([]byte, error) {
	return json.Marshal(v)
}

// Decode parses one text frame. Unknown message types are an error.
func Decode(data []byte) (Message, error) {
	var env struct {
		Type  string `json:"type"`
		Event string `json:"event"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	switch env.Type {
	case "challenge":
		return decodeInto[Challenge](data)
	case "auth":
		return decodeInto[Auth](data)
	case "welcome":
		return decodeInto[Welcome](data)
	case "rejected":
		return decodeInto[Rejected](data)
	case "request":
		return decodeInto[Request](data)
	case "response":
		return decodeInto[Response](data)
	case "event":
		switch env.Event {
		case "data":
			return decodeInto[DataEvent](data)
		case "closed":
			return decodeInto[ClosedEvent](data)
		default:
			return nil, fmt.Errorf("unknown event %q", env.Event)
		}
	default:
		return nil, fmt.Errorf("unknown message type %q", env.Type)
	}
}

func decodeInto[T any](data []byte) (*T, error) {
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, err
	}
	return &v, nil
}
