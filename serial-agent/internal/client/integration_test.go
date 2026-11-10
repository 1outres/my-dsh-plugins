package client_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/client"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/identity"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/manager"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/ports"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/serialport"
)

const testVersion = "0.1.0-test"

type logWriter struct {
	t *testing.T
}

func (w logWriter) Write(data []byte) (int, error) {
	w.t.Log(strings.TrimRight(string(data), "\n"))
	return len(data), nil
}

func TestSerialAgentOverPseudoTerminal(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(logWriter{t}, &slog.HandlerOptions{Level: slog.LevelDebug}))

	identityPath := filepath.Join(t.TempDir(), "identity")
	agentIdentity, err := identity.Generate(identityPath)
	if err != nil {
		t.Fatalf("Generate identity: %v", err)
	}

	ptmx, pts, err := pty.Open()
	if err != nil {
		t.Fatalf("pty.Open: %v", err)
	}
	defer ptmx.Close()
	devicePath := pts.Name()
	defer pts.Close()

	gateway := &fakeGateway{t: t, publicKey: agentIdentity.PublicKey(), connections: make(chan *websocket.Conn, 8)}
	server := httptest.NewServer(http.HandlerFunc(gateway.serveHTTP))
	defer server.Close()
	serverURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/remote-serial/agent"

	portManager, err := manager.New(manager.Options{
		Allow:         ports.New([]string{devicePath}),
		Opener:        serialport.SystemOpener{},
		BufferBytes:   1 << 20,
		OrphanTimeout: 0,
		Logger:        logger,
	})
	if err != nil {
		t.Fatalf("manager.New: %v", err)
	}
	defer portManager.CloseAll()

	agent, err := client.New(client.Options{
		Server:           serverURL,
		Identity:         agentIdentity,
		Manager:          portManager,
		Logger:           logger,
		Version:          testVersion,
		HandshakeTimeout: 2 * time.Second,
		PingInterval:     time.Second,
		IdleTimeout:      5 * time.Second,
		ReconnectMin:     10 * time.Millisecond,
		ReconnectMax:     100 * time.Millisecond,
		AuthRetryDelay:   100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("client.New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runErr := make(chan error, 1)
	go func() { runErr <- agent.Run(ctx) }()

	conn := waitForConnection(t, gateway.connections)
	defer conn.CloseNow()

	settings := protocol.SerialSettings{BaudRate: 9600, DataBits: 8, Parity: "none", StopBits: 1, FlowControl: "none"}

	sendRequest(t, conn, 1, "ports.list", protocol.PortsListParams{})
	listResponse := expectResponse(t, conn, 1)
	if listResponse.Error != nil {
		t.Fatalf("ports.list failed: %+v", listResponse.Error)
	}
	var list protocol.PortsListResult
	decodeResult(t, listResponse, &list)
	if !containsPort(list.Ports, devicePath) {
		t.Fatalf("device %s missing from %+v", devicePath, list.Ports)
	}

	sendRequest(t, conn, 2, "port.open", protocol.PortOpenParams{Path: devicePath, Settings: settings})
	openResponse := expectResponse(t, conn, 2)
	if openResponse.Error != nil {
		t.Fatalf("port.open failed: %+v", openResponse.Error)
	}
	var opened protocol.PortOpenResult
	decodeResult(t, openResponse, &opened)
	if opened.Handle != "p1" || opened.Reused {
		t.Fatalf("unexpected open result: %+v", opened)
	}

	sendRequest(t, conn, 3, "port.subscribe", protocol.PortSubscribeParams{Handle: opened.Handle, From: 0})
	subscribeResponse := expectResponse(t, conn, 3)
	if subscribeResponse.Error != nil {
		t.Fatalf("port.subscribe failed: %+v", subscribeResponse.Error)
	}
	var subscribed protocol.PortSubscribeResult
	decodeResult(t, subscribeResponse, &subscribed)
	if subscribed.From != 0 || subscribed.Lost != 0 {
		t.Fatalf("unexpected subscribe result: %+v", subscribed)
	}

	if _, err := ptmx.Write([]byte("hello")); err != nil {
		t.Fatalf("write pty: %v", err)
	}
	hello := readData(t, conn, 5)
	if hello.offset != 0 || string(hello.data) != "hello" {
		t.Fatalf("unexpected data event: offset %d, %q", hello.offset, hello.data)
	}

	sendRequest(t, conn, 4, "port.write", protocol.PortWriteParams{Handle: opened.Handle, Data: []byte("world")})
	writeResponse := expectResponse(t, conn, 4)
	if writeResponse.Error != nil {
		t.Fatalf("port.write failed: %+v", writeResponse.Error)
	}
	var written protocol.PortWriteResult
	decodeResult(t, writeResponse, &written)
	if written.Written != 5 {
		t.Fatalf("written = %d", written.Written)
	}
	if err := ptmx.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 5)
	if _, err := io.ReadFull(ptmx, buffer); err != nil {
		t.Fatalf("read pty: %v", err)
	}
	if string(buffer) != "world" {
		t.Fatalf("pty received %q", buffer)
	}

	sendRequest(t, conn, 5, "port.break", protocol.PortBreakParams{Handle: opened.Handle, DurationMs: 100})
	breakResponse := expectResponse(t, conn, 5)
	if breakResponse.Error != nil {
		if breakResponse.Error.Code != protocol.CodeIO && breakResponse.Error.Code != protocol.CodeUnsupported {
			t.Fatalf("port.break failed with an unexpected code: %+v", breakResponse.Error)
		}
		t.Logf("pseudo terminal refused BREAK: %+v", breakResponse.Error)
	}

	if err := conn.Close(websocket.StatusNormalClosure, "test restart"); err != nil {
		t.Logf("close first connection: %v", err)
	}
	if _, err := ptmx.Write([]byte("during")); err != nil {
		t.Fatalf("write pty while disconnected: %v", err)
	}

	reconnected := waitForConnection(t, gateway.connections)
	defer reconnected.CloseNow()

	sendRequest(t, reconnected, 6, "port.subscribe", protocol.PortSubscribeParams{Handle: opened.Handle, From: 5})
	backlog := readDataBeforeResponse(t, reconnected, 6, 6)
	if backlog.offset != 5 || string(backlog.data) != "during" {
		t.Fatalf("unexpected backlog: offset %d, %q", backlog.offset, backlog.data)
	}
	var resubscribed protocol.PortSubscribeResult
	decodeResult(t, backlog.response, &resubscribed)
	if resubscribed.From != 5 || resubscribed.Lost != 0 {
		t.Fatalf("unexpected resubscribe result: %+v", resubscribed)
	}

	sendRequest(t, reconnected, 7, "port.close", protocol.PortCloseParams{Handle: opened.Handle})
	closeResponse := expectResponse(t, reconnected, 7)
	if closeResponse.Error != nil {
		t.Fatalf("port.close failed: %+v", closeResponse.Error)
	}

	sendRequest(t, reconnected, 8, "port.subscribe", protocol.PortSubscribeParams{Handle: opened.Handle, From: 0})
	missingResponse := expectResponse(t, reconnected, 8)
	if missingResponse.Error == nil || missingResponse.Error.Code != protocol.CodeUnknownHandle {
		t.Fatalf("subscribe after close = %+v", missingResponse)
	}

	closeReadCtx := reconnected.CloseRead(context.Background())
	cancel()
	select {
	case err := <-runErr:
		if err != nil {
			t.Fatalf("agent.Run: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("agent did not stop")
	}
	<-closeReadCtx.Done()
}

type fakeGateway struct {
	t           *testing.T
	publicKey   ed25519.PublicKey
	connections chan *websocket.Conn
}

func (g *fakeGateway) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		http.Error(w, "origin header is not allowed", http.StatusForbidden)
		return
	}
	if agent := r.Header.Get("User-Agent"); agent != "dsh-serial-agent/"+testVersion {
		g.t.Errorf("User-Agent = %q", agent)
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		g.t.Errorf("accept: %v", err)
		return
	}
	if err := g.handshake(conn); err != nil {
		g.t.Errorf("handshake: %v", err)
		_ = conn.CloseNow()
		return
	}
	select {
	case g.connections <- conn:
	case <-time.After(5 * time.Second):
		g.t.Errorf("no test reader for the accepted connection")
		_ = conn.CloseNow()
	}
}

func (g *fakeGateway) handshake(conn *websocket.Conn) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	nonceBytes := make([]byte, 32)
	if _, err := rand.Read(nonceBytes); err != nil {
		return err
	}
	nonce := base64.StdEncoding.EncodeToString(nonceBytes)
	if err := writeJSON(ctx, conn, map[string]any{"type": "challenge", "protocol": protocol.Version, "nonce": nonce}); err != nil {
		return err
	}

	var auth protocol.Auth
	if err := readJSON(ctx, conn, &auth); err != nil {
		return err
	}
	if auth.Type != "auth" || auth.Protocol != protocol.Version {
		return fmt.Errorf("unexpected auth message: %+v", auth)
	}
	if auth.PublicKey != identity.PublicKeyText(g.publicKey) {
		return fmt.Errorf("unexpected public key %q", auth.PublicKey)
	}
	if auth.Agent.Version != testVersion || auth.Agent.OS != runtime.GOOS || auth.Agent.Arch != runtime.GOARCH || auth.Agent.Hostname == "" {
		return fmt.Errorf("unexpected agent info: %+v", auth.Agent)
	}
	signature, err := base64.StdEncoding.DecodeString(auth.Signature)
	if err != nil {
		return fmt.Errorf("signature is not base64: %w", err)
	}
	if !ed25519.Verify(g.publicKey, identity.AuthMessage(nonce), signature) {
		return fmt.Errorf("signature does not verify")
	}
	return writeJSON(ctx, conn, map[string]any{"type": "welcome", "name": "test-agent"})
}

type wireFrame struct {
	Type    string          `json:"type"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *protocol.Error `json:"error"`
	Event   string          `json:"event"`
	Handle  string          `json:"handle"`
	Offset  int64           `json:"offset"`
	Data    []byte          `json:"data"`
	Reason  string          `json:"reason"`
	Message string          `json:"message"`
}

func writeJSON(ctx context.Context, conn *websocket.Conn, value any) error {
	frame, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, frame)
}

func readJSON(ctx context.Context, conn *websocket.Conn, target any) error {
	messageType, data, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	if messageType != websocket.MessageText {
		return fmt.Errorf("received a binary frame")
	}
	return json.Unmarshal(data, target)
}

func waitForConnection(t *testing.T, connections <-chan *websocket.Conn) *websocket.Conn {
	t.Helper()
	select {
	case conn := <-connections:
		return conn
	case <-time.After(5 * time.Second):
		t.Fatal("the agent did not connect")
		return nil
	}
}

func sendRequest(t *testing.T, conn *websocket.Conn, id int64, method string, params any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	frame, err := protocol.NewRequest(id, method, params)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if err := conn.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatalf("send %s: %v", method, err)
	}
}

func readFrame(t *testing.T, conn *websocket.Conn) wireFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var frame wireFrame
	if err := readJSON(ctx, conn, &frame); err != nil {
		t.Fatalf("read frame: %v", err)
	}
	return frame
}

func expectResponse(t *testing.T, conn *websocket.Conn, id int64) wireFrame {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		frame := readFrame(t, conn)
		if frame.Type == "event" {
			t.Fatalf("unexpected event %q before response %d", frame.Event, id)
		}
		if frame.Type != "response" || frame.ID != id {
			t.Fatalf("unexpected frame: %+v", frame)
		}
		return frame
	}
	t.Fatalf("no response %d", id)
	return wireFrame{}
}

func decodeResult(t *testing.T, frame wireFrame, target any) {
	t.Helper()
	if err := json.Unmarshal(frame.Result, target); err != nil {
		t.Fatalf("decode result %s: %v", frame.Result, err)
	}
}

type dataChunk struct {
	offset int64
	data   []byte
}

func readData(t *testing.T, conn *websocket.Conn, size int) dataChunk {
	t.Helper()
	var chunk dataChunk
	deadline := time.Now().Add(5 * time.Second)
	for len(chunk.data) < size && time.Now().Before(deadline) {
		frame := readFrame(t, conn)
		if frame.Type != "event" || frame.Event != "data" {
			t.Fatalf("unexpected frame: %+v", frame)
		}
		if len(chunk.data) == 0 {
			chunk.offset = frame.Offset
		}
		chunk.data = append(chunk.data, frame.Data...)
	}
	if len(chunk.data) != size {
		t.Fatalf("read %d data bytes, want %d", len(chunk.data), size)
	}
	return chunk
}

type backlogChunk struct {
	offset   int64
	data     []byte
	response wireFrame
}

func readDataBeforeResponse(t *testing.T, conn *websocket.Conn, id int64, size int) backlogChunk {
	t.Helper()
	var chunk backlogChunk
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		frame := readFrame(t, conn)
		switch {
		case frame.Type == "event" && frame.Event == "data":
			if len(chunk.data) == 0 {
				chunk.offset = frame.Offset
			}
			chunk.data = append(chunk.data, frame.Data...)
		case frame.Type == "response" && frame.ID == id:
			chunk.response = frame
			if len(chunk.data) != size {
				t.Fatalf("got %d backlog bytes, want %d", len(chunk.data), size)
			}
			return chunk
		default:
			t.Fatalf("unexpected frame: %+v", frame)
		}
	}
	t.Fatalf("no backlog and response for request %d", id)
	return chunk
}

func containsPort(list []protocol.PortInfo, path string) bool {
	for _, info := range list {
		if info.Path == path {
			return true
		}
	}
	return false
}
