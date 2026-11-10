// Package client keeps one WebSocket session with the Harness serial gateway.
package client

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/identity"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/manager"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
)

// WebSocket close codes from PROTOCOL.md.
const (
	statusProtocolError websocket.StatusCode = 4400
	statusAuthFailed    websocket.StatusCode = 4401
	statusKeyUnknown    websocket.StatusCode = 4403
)

const (
	defaultHandshakeTimeout = 10 * time.Second
	defaultPingInterval     = 20 * time.Second
	defaultIdleTimeout      = 60 * time.Second
	defaultReconnectMin     = time.Second
	defaultReconnectMax     = 30 * time.Second
	defaultAuthRetryDelay   = 60 * time.Second
	writeTimeout            = 30 * time.Second
)

// Options configures a Client.
type Options struct {
	Server    string
	Identity  *identity.Identity
	Manager   *manager.Manager
	Logger    *slog.Logger
	Version   string
	UserAgent string

	HandshakeTimeout time.Duration
	PingInterval     time.Duration
	IdleTimeout      time.Duration
	ReconnectMin     time.Duration
	ReconnectMax     time.Duration
	AuthRetryDelay   time.Duration
}

// Client reconnects until its context is canceled.
type Client struct {
	server           string
	identity         *identity.Identity
	manager          *manager.Manager
	logger           *slog.Logger
	version          string
	userAgent        string
	handshakeTimeout time.Duration
	pingInterval     time.Duration
	idleTimeout      time.Duration
	reconnectMin     time.Duration
	reconnectMax     time.Duration
	authRetryDelay   time.Duration
	requests         *keyedQueue
}

// New validates options and returns a client.
func New(options Options) (*Client, error) {
	switch {
	case options.Server == "":
		return nil, errors.New("client: a server URL is required")
	case options.Identity == nil:
		return nil, errors.New("client: an identity is required")
	case options.Manager == nil:
		return nil, errors.New("client: a port manager is required")
	case options.Logger == nil:
		return nil, errors.New("client: a logger is required")
	case options.Version == "":
		return nil, errors.New("client: a version is required")
	}
	userAgent := options.UserAgent
	if userAgent == "" {
		userAgent = "dsh-serial-agent/" + options.Version
	}
	client := &Client{
		server:           options.Server,
		identity:         options.Identity,
		manager:          options.Manager,
		logger:           options.Logger,
		version:          options.Version,
		userAgent:        userAgent,
		handshakeTimeout: durationOr(options.HandshakeTimeout, defaultHandshakeTimeout),
		pingInterval:     durationOr(options.PingInterval, defaultPingInterval),
		idleTimeout:      durationOr(options.IdleTimeout, defaultIdleTimeout),
		reconnectMin:     durationOr(options.ReconnectMin, defaultReconnectMin),
		reconnectMax:     durationOr(options.ReconnectMax, defaultReconnectMax),
		authRetryDelay:   durationOr(options.AuthRetryDelay, defaultAuthRetryDelay),
		requests:         newKeyedQueue(),
	}
	if client.reconnectMax < client.reconnectMin {
		return nil, errors.New("client: reconnectMax must not be smaller than reconnectMin")
	}
	if client.idleTimeout < client.pingInterval {
		return nil, errors.New("client: idleTimeout must not be smaller than pingInterval")
	}
	return client, nil
}

func durationOr(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

// Run dials and serves until ctx is canceled. It reconnects with exponential
// backoff.
func (c *Client) Run(ctx context.Context) error {
	backoff := c.reconnectMin
	for {
		welcomed, err := c.runOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if welcomed {
			backoff = c.reconnectMin
		}
		if err == nil {
			err = errors.New("gateway closed the connection")
		}

		authFailure := isAuthFailure(err)
		delay := jitter(backoff)
		if authFailure && delay < c.authRetryDelay {
			delay = c.authRetryDelay
		}
		if authFailure {
			c.logger.Warn("gateway rejected the agent; waiting before retry", "error", err, "retryIn", delay)
		} else {
			c.logger.Warn("serial gateway connection lost", "error", err, "retryIn", delay)
		}

		if backoff < c.reconnectMax {
			backoff *= 2
			if backoff > c.reconnectMax {
				backoff = c.reconnectMax
			}
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func isAuthFailure(err error) bool {
	var rejected *rejectedError
	if errors.As(err, &rejected) {
		return true
	}
	switch websocket.CloseStatus(err) {
	case statusAuthFailed, statusKeyUnknown:
		return true
	default:
		return false
	}
}

func jitter(base time.Duration) time.Duration {
	half := base / 2
	return half + time.Duration(rand.Int63n(int64(base-half)+1))
}

func (c *Client) runOnce(ctx context.Context) (bool, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return false, fmt.Errorf("read hostname: %w", err)
	}

	handshakeCtx, cancelHandshake := context.WithTimeout(ctx, c.handshakeTimeout)
	defer cancelHandshake()

	c.logger.Debug("dialing serial gateway", "server", c.server)
	conn, response, err := websocket.Dial(handshakeCtx, c.server, &websocket.DialOptions{
		HTTPHeader: http.Header{"User-Agent": []string{c.userAgent}},
	})
	if err != nil {
		if response != nil {
			return false, fmt.Errorf("dial %s: %w (HTTP %d)", c.server, err, response.StatusCode)
		}
		return false, fmt.Errorf("dial %s: %w", c.server, err)
	}
	defer conn.CloseNow()
	conn.SetReadLimit(protocol.MaxFrameBytes)

	message, err := readMessage(handshakeCtx, conn)
	if err != nil {
		return false, fmt.Errorf("read challenge: %w", err)
	}
	challenge, ok := message.(*protocol.Challenge)
	if !ok {
		return false, c.closeProtocol(conn, "expected challenge, got %T", message)
	}
	if challenge.Protocol != protocol.Version {
		_ = conn.Close(statusAuthFailed, "unsupported protocol")
		return false, &rejectedError{
			code:    "protocol",
			message: fmt.Sprintf("gateway speaks protocol %d, agent speaks %d", challenge.Protocol, protocol.Version),
		}
	}
	nonce, err := base64.StdEncoding.DecodeString(challenge.Nonce)
	if err != nil || len(nonce) != 32 {
		return false, c.closeProtocol(conn, "challenge nonce is not base64 of 32 bytes")
	}

	auth := protocol.NewAuth(c.identity.PublicKeyText(), c.identity.SignNonce(challenge.Nonce), protocol.AgentInfo{
		Version:  c.version,
		Hostname: hostname,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
	})
	if err := writeMessage(handshakeCtx, conn, auth); err != nil {
		return false, fmt.Errorf("send auth: %w", err)
	}

	message, err = readMessage(handshakeCtx, conn)
	if err != nil {
		return false, fmt.Errorf("read welcome: %w", err)
	}
	switch welcome := message.(type) {
	case *protocol.Welcome:
		c.logger.Info("serial gateway accepted the agent", "name", welcome.Name)
	case *protocol.Rejected:
		code := closeCodeForRejection(welcome.Code)
		_ = conn.Close(code, truncateReason(welcome.Message))
		return false, &rejectedError{code: welcome.Code, message: welcome.Message}
	default:
		return false, c.closeProtocol(conn, "expected welcome or rejected, got %T", message)
	}

	session := newSession(conn, c.logger, c.pingInterval, c.idleTimeout)
	managerConn := c.manager.NewConnection(session)
	session.start()

	watchDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close(websocket.StatusNormalClosure, "shutdown")
		case <-watchDone:
		}
	}()

	serveErr := c.serve(conn, managerConn, session)

	close(watchDone)
	session.stop()
	c.manager.CloseConnection(managerConn)
	_ = conn.CloseNow()
	session.wait()

	if ctx.Err() != nil {
		return false, nil
	}
	if failure := session.failure(); failure != nil {
		return true, failure
	}
	return true, serveErr
}

func (c *Client) serve(conn *websocket.Conn, managerConn *manager.Connection, session *session) error {
	for {
		messageType, data, err := conn.Read(context.Background())
		if err != nil {
			return err
		}
		if messageType != websocket.MessageText {
			return c.closeProtocol(conn, "received a binary frame")
		}
		message, err := protocol.Decode(data)
		if err != nil {
			return c.closeProtocol(conn, "invalid message: %v", err)
		}
		request, ok := message.(*protocol.Request)
		if !ok {
			return c.closeProtocol(conn, "unexpected message %T after welcome", message)
		}
		if request.ID <= 0 {
			return c.closeProtocol(conn, "request id must be positive")
		}
		c.startRequest(conn, session, managerConn, request)
	}
}

// startRequest answers one request in its own goroutine. Requests that name a
// handle run in arrival order for that handle, so writes to a port cannot
// overtake each other.
func (c *Client) startRequest(conn *websocket.Conn, session *session, managerConn *manager.Connection, request *protocol.Request) {
	key, ordered := requestKey(request)
	var previous chan struct{}
	var release func()
	if ordered {
		previous, release = c.requests.enqueue(key)
	}
	go func() {
		if previous != nil {
			<-previous
		}
		if release != nil {
			defer release()
		}
		if err := c.handleRequest(session, managerConn, request); err != nil {
			_ = c.closeProtocol(conn, "%v", err)
			session.fail(err)
		}
	}()
}

func requestKey(request *protocol.Request) (string, bool) {
	switch request.Method {
	case "port.subscribe", "port.unsubscribe", "port.write", "port.break", "port.close":
		var params struct {
			Handle string `json:"handle"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil || params.Handle == "" {
			return "", false
		}
		return params.Handle, true
	default:
		return "", false
	}
}

type keyedQueue struct {
	mu    sync.Mutex
	tails map[string]chan struct{}
}

func newKeyedQueue() *keyedQueue {
	return &keyedQueue{tails: make(map[string]chan struct{})}
}

func (q *keyedQueue) enqueue(key string) (previous chan struct{}, release func()) {
	q.mu.Lock()
	previous = q.tails[key]
	done := make(chan struct{})
	q.tails[key] = done
	q.mu.Unlock()

	return previous, func() {
		q.mu.Lock()
		if q.tails[key] == done {
			delete(q.tails, key)
		}
		q.mu.Unlock()
		close(done)
	}
}

func (c *Client) handleRequest(session *session, managerConn *manager.Connection, request *protocol.Request) error {
	switch request.Method {
	case "ports.list":
		var params protocol.PortsListParams
		if err := protocol.DecodeParams(request.Params, &params); err != nil {
			return session.sendError(request.ID, protocol.Errorf(protocol.CodeInvalidParams, "ports.list: %v", err))
		}
		list, err := c.manager.List()
		if err != nil {
			return session.sendError(request.ID, err)
		}
		return session.sendResult(request.ID, protocol.PortsListResult{Ports: list})

	case "port.open":
		var params protocol.PortOpenParams
		if err := decodeParams(request, &params); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := params.Validate(); err != nil {
			return session.sendError(request.ID, err)
		}
		result, err := c.manager.Open(managerConn, params.Path, params.Settings)
		if err != nil {
			return session.sendError(request.ID, err)
		}
		return session.sendResult(request.ID, result)

	case "port.subscribe":
		var params protocol.PortSubscribeParams
		if err := decodeParams(request, &params); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := params.Validate(); err != nil {
			return session.sendError(request.ID, err)
		}
		var sendErr error
		subscribeErr := c.manager.Subscribe(managerConn, params.Handle, params.From,
			func(start, lost int64) {
				sendErr = session.sendResult(request.ID, protocol.PortSubscribeResult{From: start, Lost: lost})
			})
		if subscribeErr != nil {
			return session.sendError(request.ID, subscribeErr)
		}
		return sendErr

	case "port.unsubscribe":
		var params protocol.PortUnsubscribeParams
		if err := decodeParams(request, &params); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := params.Validate(); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := c.manager.Unsubscribe(managerConn, params.Handle); err != nil {
			return session.sendError(request.ID, err)
		}
		return session.sendResult(request.ID, protocol.PortUnsubscribeResult{})

	case "port.write":
		var params protocol.PortWriteParams
		if err := decodeParams(request, &params); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := params.Validate(); err != nil {
			return session.sendError(request.ID, err)
		}
		written, err := c.manager.Write(params.Handle, params.Data)
		if err != nil {
			return session.sendError(request.ID, err)
		}
		return session.sendResult(request.ID, protocol.PortWriteResult{Written: written})

	case "port.break":
		var params protocol.PortBreakParams
		if err := decodeParams(request, &params); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := params.Validate(); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := c.manager.Break(params.Handle, time.Duration(params.DurationMs)*time.Millisecond); err != nil {
			return session.sendError(request.ID, err)
		}
		return session.sendResult(request.ID, protocol.PortBreakResult{})

	case "port.close":
		var params protocol.PortCloseParams
		if err := decodeParams(request, &params); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := params.Validate(); err != nil {
			return session.sendError(request.ID, err)
		}
		if err := c.manager.ClosePort(params.Handle); err != nil {
			return session.sendError(request.ID, err)
		}
		return session.sendResult(request.ID, protocol.PortCloseResult{})

	default:
		return session.sendError(request.ID, protocol.Errorf(protocol.CodeUnknownMethod, "unknown method %q", request.Method))
	}
}

func decodeParams(request *protocol.Request, target interface{ Validate() error }) error {
	if err := protocol.DecodeParams(request.Params, target); err != nil {
		return protocol.Errorf(protocol.CodeInvalidParams, "%s: %v", request.Method, err)
	}
	return nil
}

func (c *Client) closeProtocol(conn *websocket.Conn, format string, args ...any) error {
	message := fmt.Sprintf(format, args...)
	_ = conn.Close(statusProtocolError, truncateReason(message))
	return fmt.Errorf("protocol error: %s", message)
}

func readMessage(ctx context.Context, conn *websocket.Conn) (protocol.Message, error) {
	messageType, data, err := conn.Read(ctx)
	if err != nil {
		return nil, err
	}
	if messageType != websocket.MessageText {
		return nil, errors.New("received a binary frame")
	}
	return protocol.Decode(data)
}

func writeMessage(ctx context.Context, conn *websocket.Conn, message any) error {
	frame, err := protocol.Encode(message)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, frame)
}

func truncateReason(reason string) string {
	const limit = 120
	if len(reason) <= limit {
		return reason
	}
	reason = reason[:limit]
	for len(reason) > 0 && !utf8.ValidString(reason) {
		reason = reason[:len(reason)-1]
	}
	return reason
}

func closeCodeForRejection(code string) websocket.StatusCode {
	switch code {
	case "protocol", "bad-signature":
		return statusAuthFailed
	case "unknown-key":
		return statusKeyUnknown
	default:
		return statusProtocolError
	}
}

type rejectedError struct {
	code    string
	message string
}

func (e *rejectedError) Error() string {
	return fmt.Sprintf("gateway rejected the agent: %s (%s)", e.message, e.code)
}

type session struct {
	conn        *websocket.Conn
	logger      *slog.Logger
	out         chan []byte
	done        chan struct{}
	stopOnce    sync.Once
	wg          sync.WaitGroup
	pingEvery   time.Duration
	idleTimeout time.Duration

	errMu      sync.Mutex
	failureErr error
}

func newSession(conn *websocket.Conn, logger *slog.Logger, pingEvery, idleTimeout time.Duration) *session {
	return &session{
		conn:        conn,
		logger:      logger,
		out:         make(chan []byte, 64),
		done:        make(chan struct{}),
		pingEvery:   pingEvery,
		idleTimeout: idleTimeout,
	}
}

func (s *session) start() {
	s.wg.Add(2)
	go s.writer()
	go s.pinger()
}

func (s *session) stop() {
	s.stopOnce.Do(func() { close(s.done) })
}

func (s *session) wait() {
	s.wg.Wait()
}

func (s *session) failure() error {
	s.errMu.Lock()
	defer s.errMu.Unlock()
	return s.failureErr
}

func (s *session) fail(err error) {
	s.errMu.Lock()
	if s.failureErr == nil {
		s.failureErr = err
	}
	s.errMu.Unlock()
	_ = s.conn.CloseNow()
}

// Data sends one data event. The manager calls it from the reader of the port.
func (s *session) Data(handle string, offset int64, data []byte) {
	if err := s.send(protocol.NewDataEvent(handle, offset, data)); err != nil {
		s.logger.Error("encode data event", "handle", handle, "error", err)
	}
}

// Closed sends one closed event.
func (s *session) Closed(handle, reason, message string) {
	if err := s.send(protocol.NewClosedEvent(handle, reason, message)); err != nil {
		s.logger.Error("encode closed event", "handle", handle, "error", err)
	}
}

func (s *session) send(message any) error {
	frame, err := protocol.Encode(message)
	if err != nil {
		return err
	}
	select {
	case s.out <- frame:
	case <-s.done:
	}
	return nil
}

func (s *session) sendResult(id int64, result any) error {
	response, err := protocol.NewResultResponse(id, result)
	if err != nil {
		return err
	}
	return s.send(response)
}

func (s *session) sendError(id int64, err error) error {
	var coded *protocol.Error
	if errors.As(err, &coded) {
		return s.send(protocol.NewErrorResponse(id, coded.Code, coded.Message))
	}
	return s.send(protocol.NewErrorResponse(id, protocol.CodeIO, err.Error()))
}

func (s *session) writer() {
	defer s.wg.Done()
	for {
		select {
		case <-s.done:
			return
		case frame := <-s.out:
			ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
			err := s.conn.Write(ctx, websocket.MessageText, frame)
			cancel()
			if err != nil {
				s.fail(fmt.Errorf("write frame: %w", err))
				return
			}
		}
	}
}

func (s *session) pinger() {
	defer s.wg.Done()
	ticker := time.NewTicker(s.pingEvery)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			// A pong sent now must arrive before the idle window ends, so the
			// peer is dropped after idleTimeout without any traffic.
			timeout := s.idleTimeout - s.pingEvery
			if timeout <= 0 {
				timeout = s.idleTimeout
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			err := s.conn.Ping(ctx)
			cancel()
			if err != nil {
				s.fail(fmt.Errorf("heartbeat: %w", err))
				return
			}
		}
	}
}
