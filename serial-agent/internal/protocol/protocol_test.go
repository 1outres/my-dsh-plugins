package protocol

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDecodeChallenge(t *testing.T) {
	message, err := Decode([]byte(`{"type":"challenge","protocol":1,"nonce":"abc"}`))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	challenge, ok := message.(*Challenge)
	if !ok {
		t.Fatalf("got %T, want *Challenge", message)
	}
	if challenge.Protocol != 1 || challenge.Nonce != "abc" {
		t.Fatalf("unexpected challenge: %+v", challenge)
	}
}

func TestDecodeRequest(t *testing.T) {
	message, err := Decode([]byte(`{"type":"request","id":7,"method":"port.open","params":{"path":"/dev/ttyUSB0"}}`))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	request, ok := message.(*Request)
	if !ok {
		t.Fatalf("got %T, want *Request", message)
	}
	if request.ID != 7 || request.Method != "port.open" {
		t.Fatalf("unexpected request: %+v", request)
	}
	var params PortOpenParams
	if err := DecodeParams(request.Params, &params); err != nil {
		t.Fatalf("DecodeParams: %v", err)
	}
	if params.Path != "/dev/ttyUSB0" {
		t.Fatalf("unexpected params: %+v", params)
	}
}

func TestDecodeRejectsUnknownType(t *testing.T) {
	if _, err := Decode([]byte(`{"type":"nope"}`)); err == nil || !strings.Contains(err.Error(), "unknown message type") {
		t.Fatalf("got %v, want an unknown type error", err)
	}
}

func TestDecodeParamsRejectsUnknownField(t *testing.T) {
	var params PortOpenParams
	err := DecodeParams(json.RawMessage(`{"path":"/dev/null","extra":1}`), &params)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("got %v, want an unknown field error", err)
	}
}

func TestDecodeParamsRejectsNonObject(t *testing.T) {
	var params PortsListParams
	for _, raw := range []string{"null", "[]", "1", ""} {
		if err := DecodeParams(json.RawMessage(raw), &params); err == nil {
			t.Fatalf("DecodeParams(%q) succeeded", raw)
		}
	}
}

func TestDecodeParamsRejectsTrailingData(t *testing.T) {
	var params PortOpenParams
	if err := DecodeParams(json.RawMessage(`{"path":"/dev/null"} {}`), &params); err == nil {
		t.Fatal("expected an error for trailing data")
	}
}

func TestSerialSettingsValidate(t *testing.T) {
	valid := SerialSettings{BaudRate: 9600, DataBits: 8, Parity: "none", StopBits: 1, FlowControl: "none"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid settings refused: %v", err)
	}
	tests := []struct {
		name   string
		mutate func(*SerialSettings)
	}{
		{"baudRate zero", func(s *SerialSettings) { s.BaudRate = 0 }},
		{"baudRate negative", func(s *SerialSettings) { s.BaudRate = -1 }},
		{"dataBits low", func(s *SerialSettings) { s.DataBits = 4 }},
		{"dataBits high", func(s *SerialSettings) { s.DataBits = 9 }},
		{"parity", func(s *SerialSettings) { s.Parity = "mark" }},
		{"stopBits", func(s *SerialSettings) { s.StopBits = 3 }},
		{"flowControl", func(s *SerialSettings) { s.FlowControl = "rts" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			settings := valid
			test.mutate(&settings)
			err := settings.Validate()
			var coded *Error
			if !errors.As(err, &coded) || coded.Code != CodeInvalidParams {
				t.Fatalf("got %v, want %s", err, CodeInvalidParams)
			}
		})
	}
}

func TestPortParamsValidate(t *testing.T) {
	if err := (PortOpenParams{Path: " ", Settings: SerialSettings{BaudRate: 9600, DataBits: 8, Parity: "none", StopBits: 1, FlowControl: "none"}}).Validate(); err == nil {
		t.Fatal("expected an empty path error")
	}
	if err := (PortSubscribeParams{Handle: "p1", From: -1}).Validate(); err == nil {
		t.Fatal("expected a negative offset error")
	}
	if err := (PortBreakParams{Handle: "p1", DurationMs: 0}).Validate(); err == nil {
		t.Fatal("expected a duration error")
	}
	if err := (PortBreakParams{Handle: "p1", DurationMs: 5001}).Validate(); err == nil {
		t.Fatal("expected a duration error")
	}
	if err := (PortWriteParams{Handle: "p1", Data: make([]byte, MaxWriteBytes+1)}).Validate(); err == nil {
		t.Fatal("expected a write size error")
	}
}

func TestResponseMarshalExclusivity(t *testing.T) {
	response, err := NewResultResponse(1, PortsListResult{Ports: []PortInfo{}})
	if err != nil {
		t.Fatalf("NewResultResponse: %v", err)
	}
	data, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !strings.Contains(string(data), `"type":"response"`) || !strings.Contains(string(data), `"result":{"ports":[]}`) {
		t.Fatalf("unexpected response: %s", data)
	}
	if _, err := json.Marshal(Response{Type: "response", ID: 1}); err == nil {
		t.Fatal("expected an error for a response without result or error")
	}
	if _, err := json.Marshal(Response{Type: "response", ID: 1, Result: json.RawMessage(`{}`), Error: &Error{Code: "io"}}); err == nil {
		t.Fatal("expected an error for a response with both result and error")
	}
}

func TestDataEventIsBase64Text(t *testing.T) {
	event := NewDataEvent("p1", 5, []byte{0, 1, 2})
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	expected := base64.StdEncoding.EncodeToString([]byte{0, 1, 2})
	if !strings.Contains(string(data), `"data":"`+expected+`"`) {
		t.Fatalf("unexpected event: %s", data)
	}
	if !strings.Contains(string(data), `"offset":5`) || !strings.Contains(string(data), `"event":"data"`) {
		t.Fatalf("unexpected event: %s", data)
	}
}

func TestNewRequestRoundTrip(t *testing.T) {
	frame, err := NewRequest(3, "port.write", PortWriteParams{Handle: "p1", Data: []byte("hi")})
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	message, err := Decode(frame)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	request, ok := message.(*Request)
	if !ok {
		t.Fatalf("got %T, want *Request", message)
	}
	var params PortWriteParams
	if err := DecodeParams(request.Params, &params); err != nil {
		t.Fatalf("DecodeParams: %v", err)
	}
	if params.Handle != "p1" || string(params.Data) != "hi" {
		t.Fatalf("unexpected params: %+v", params)
	}
}
