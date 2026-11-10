// Package manager owns the open serial ports, their buffers, and their
// subscribers.
package manager

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/buffer"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/ports"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/serialport"
)

// EventSink receives the events of the ports it subscribed to.
type EventSink interface {
	Data(handle string, offset int64, data []byte)
	Closed(handle, reason, message string)
}

// Options configures a Manager.
type Options struct {
	Allow         *ports.Enumerator
	Opener        serialport.Opener
	BufferBytes   int
	OrphanTimeout time.Duration
	Logger        *slog.Logger
}

// Manager holds every open port of this agent process.
type Manager struct {
	allow         *ports.Enumerator
	opener        serialport.Opener
	bufferBytes   int
	orphanTimeout time.Duration
	logger        *slog.Logger

	mu          sync.Mutex
	byPath      map[string]*openPort
	byHandle    map[string]*openPort
	nextHandle  int
	connections map[*Connection]struct{}
}

type openPort struct {
	path     string
	handle   string
	port     serialport.Port
	buffer   *buffer.Buffer
	settings protocol.SerialSettings

	writeMu sync.Mutex
	closed  atomic.Bool

	subscription *buffer.Subscription
	subscriber   *Connection
	lastConn     *Connection
	orphanGen    uint64
}

// Connection identifies one WebSocket session. Its subscriptions end when the
// connection closes; the ports stay open.
type Connection struct {
	manager *Manager
	sink    EventSink
	subs    map[string]struct{}
	closed  bool
}

// New validates the options and returns a manager.
func New(options Options) (*Manager, error) {
	switch {
	case options.Allow == nil:
		return nil, errors.New("manager: an allow-list enumerator is required")
	case options.Opener == nil:
		return nil, errors.New("manager: a serial opener is required")
	case options.BufferBytes <= 0:
		return nil, errors.New("manager: bufferBytes must be positive")
	case options.OrphanTimeout < 0:
		return nil, errors.New("manager: orphanTimeout must not be negative")
	case options.Logger == nil:
		return nil, errors.New("manager: a logger is required")
	}
	return &Manager{
		allow:         options.Allow,
		opener:        options.Opener,
		bufferBytes:   options.BufferBytes,
		orphanTimeout: options.OrphanTimeout,
		logger:        options.Logger,
		byPath:        make(map[string]*openPort),
		byHandle:      make(map[string]*openPort),
		connections:   make(map[*Connection]struct{}),
	}, nil
}

// NewConnection registers a session that can subscribe to ports.
func (m *Manager) NewConnection(sink EventSink) *Connection {
	m.mu.Lock()
	defer m.mu.Unlock()
	conn := &Connection{manager: m, sink: sink, subs: make(map[string]struct{})}
	m.connections[conn] = struct{}{}
	return conn
}

// CloseConnection ends the subscriptions of conn. The ports stay open.
func (m *Manager) CloseConnection(conn *Connection) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for handle := range conn.subs {
		port := m.byHandle[handle]
		if port == nil || port.subscriber != conn {
			continue
		}
		port.subscription.Cancel()
		port.subscription = nil
		port.subscriber = nil
		port.lastConn = conn
		m.scheduleOrphanLocked(port)
	}
	conn.closed = true
	delete(m.connections, conn)
}

func (m *Manager) checkConnectionLocked(conn *Connection) error {
	if conn == nil || conn.closed {
		return protocol.Errorf(protocol.CodeIO, "connection is closed")
	}
	return nil
}

// Open opens path or updates the settings of the port already open there.
func (m *Manager) Open(conn *Connection, requested string, settings protocol.SerialSettings) (protocol.PortOpenResult, error) {
	if err := settings.Validate(); err != nil {
		return protocol.PortOpenResult{}, err
	}
	path, err := m.allow.CheckOpenPath(requested)
	if err != nil {
		return protocol.PortOpenResult{}, err
	}
	converted, err := convertSettings(settings)
	if err != nil {
		return protocol.PortOpenResult{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.checkConnectionLocked(conn); err != nil {
		return protocol.PortOpenResult{}, err
	}

	if port, ok := m.byPath[path]; ok {
		port.writeMu.Lock()
		err := port.port.SetSettings(converted)
		port.writeMu.Unlock()
		if err != nil {
			return protocol.PortOpenResult{}, serialError(err, "configure "+path)
		}
		port.settings = settings
		start, end := port.buffer.Bounds()
		return protocol.PortOpenResult{Handle: port.handle, Reused: true, Start: start, End: end}, nil
	}

	device, err := m.opener.Open(path, converted)
	if err != nil {
		return protocol.PortOpenResult{}, serialError(err, "open "+path)
	}
	m.nextHandle++
	port := &openPort{
		path:     path,
		handle:   fmt.Sprintf("p%d", m.nextHandle),
		port:     device,
		buffer:   buffer.New(m.bufferBytes),
		settings: settings,
	}
	m.byPath[path] = port
	m.byHandle[port.handle] = port
	m.scheduleOrphanLocked(port)
	go m.readLoop(port)
	start, end := port.buffer.Bounds()
	m.logger.Info("opened serial port", "path", path, "handle", port.handle,
		"settings", settings.BaudRate, "bufferBytes", m.bufferBytes)
	return protocol.PortOpenResult{Handle: port.handle, Reused: false, Start: start, End: end}, nil
}

// Subscribe starts data events for handle on conn at the given offset. ready
// runs after the backlog has been delivered to the sink and before live bytes
// can follow, so it can send the response to port.subscribe.
func (m *Manager) Subscribe(conn *Connection, handle string, from int64, ready func(start, lost int64)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.checkConnectionLocked(conn); err != nil {
		return err
	}
	port := m.byHandle[handle]
	if port == nil {
		return protocol.Errorf(protocol.CodeUnknownHandle, "no open port has handle %q", handle)
	}
	if port.subscription != nil {
		port.subscription.Cancel()
		port.subscription = nil
		if port.subscriber != nil {
			delete(port.subscriber.subs, handle)
			port.subscriber = nil
		}
	}

	subscription := port.buffer.Subscribe(from, func(chunk buffer.Chunk) {
		conn.sink.Data(handle, chunk.Offset, chunk.Data)
	}, ready)
	port.subscription = subscription
	port.subscriber = conn
	port.lastConn = conn
	conn.subs[handle] = struct{}{}
	port.orphanGen++

	return nil
}

// Unsubscribe stops data events on conn for handle.
func (m *Manager) Unsubscribe(conn *Connection, handle string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.checkConnectionLocked(conn); err != nil {
		return err
	}
	port := m.byHandle[handle]
	if port == nil {
		return protocol.Errorf(protocol.CodeUnknownHandle, "no open port has handle %q", handle)
	}
	if port.subscriber == conn && port.subscription != nil {
		port.subscription.Cancel()
		port.subscription = nil
		port.subscriber = nil
		port.lastConn = conn
		delete(conn.subs, handle)
		m.scheduleOrphanLocked(port)
	}
	return nil
}

// Write sends all bytes to the port. Writes to one port stay in order.
func (m *Manager) Write(handle string, data []byte) (int, error) {
	port, err := m.lookup(handle)
	if err != nil {
		return 0, err
	}

	port.writeMu.Lock()
	defer port.writeMu.Unlock()
	if port.closed.Load() {
		return 0, protocol.Errorf(protocol.CodeUnknownHandle, "no open port has handle %q", handle)
	}

	written := 0
	for written < len(data) {
		n, err := port.port.Write(data[written:])
		written += n
		if err != nil {
			return written, serialError(err, "write "+port.path)
		}
		if n == 0 {
			return written, protocol.Errorf(protocol.CodeIO, "write %s made no progress", port.path)
		}
	}
	return written, nil
}

// Break holds the line in the BREAK state.
func (m *Manager) Break(handle string, duration time.Duration) error {
	port, err := m.lookup(handle)
	if err != nil {
		return err
	}

	port.writeMu.Lock()
	defer port.writeMu.Unlock()
	if port.closed.Load() {
		return protocol.Errorf(protocol.CodeUnknownHandle, "no open port has handle %q", handle)
	}
	if err := port.port.Break(duration); err != nil {
		return serialError(err, "break "+port.path)
	}
	return nil
}

// ClosePort closes handle and drops its buffer. It sends no closed event.
func (m *Manager) ClosePort(handle string) error {
	m.mu.Lock()
	port := m.byHandle[handle]
	if port == nil {
		m.mu.Unlock()
		return protocol.Errorf(protocol.CodeUnknownHandle, "no open port has handle %q", handle)
	}
	m.removeLocked(port)
	m.mu.Unlock()

	port.writeMu.Lock()
	closeErr := port.port.Close()
	port.writeMu.Unlock()
	m.logger.Info("closed serial port", "path", port.path, "handle", port.handle)
	if closeErr != nil {
		return serialError(closeErr, "close "+port.path)
	}
	return nil
}

// List returns the allowed devices plus every open port.
func (m *Manager) List() ([]protocol.PortInfo, error) {
	type openSnapshot struct {
		handle   string
		settings protocol.SerialSettings
	}

	m.mu.Lock()
	open := make(map[string]openSnapshot, len(m.byPath))
	paths := make([]string, 0, len(m.byPath))
	for path, port := range m.byPath {
		open[path] = openSnapshot{handle: port.handle, settings: port.settings}
		paths = append(paths, path)
	}
	m.mu.Unlock()

	devices, err := m.allow.List(paths)
	if err != nil {
		return nil, protocol.Errorf(protocol.CodeIO, "list serial ports: %v", err)
	}
	result := make([]protocol.PortInfo, 0, len(devices))
	for _, device := range devices {
		info := protocol.PortInfo{
			Path:        device.Path,
			Description: device.Description,
			USB:         device.USB,
		}
		if port, ok := open[device.Path]; ok {
			settings := port.settings
			info.Open = true
			info.Handle = port.handle
			info.Settings = &settings
		}
		result = append(result, info)
	}
	return result, nil
}

// CloseAll closes every open port. It is used on shutdown.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := make([]*openPort, 0, len(m.byHandle))
	for _, port := range m.byHandle {
		m.removeLocked(port)
		all = append(all, port)
	}
	m.mu.Unlock()

	for _, port := range all {
		if !port.writeMu.TryLock() {
			// The process is exiting, so the OS releases the device. Closing
			// it under a blocked write could reuse the descriptor.
			m.logger.Warn("serial port is busy writing; leaving it open for the OS to close", "path", port.path)
			continue
		}
		err := port.port.Close()
		port.writeMu.Unlock()
		if err != nil {
			m.logger.Warn("close serial port failed", "path", port.path, "error", err)
		}
	}
}

func (m *Manager) lookup(handle string) (*openPort, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	port := m.byHandle[handle]
	if port == nil {
		return nil, protocol.Errorf(protocol.CodeUnknownHandle, "no open port has handle %q", handle)
	}
	return port, nil
}

func (m *Manager) removeLocked(port *openPort) {
	port.closed.Store(true)
	delete(m.byPath, port.path)
	delete(m.byHandle, port.handle)
	if port.subscription != nil {
		port.subscription.Cancel()
		port.subscription = nil
	}
	if port.subscriber != nil {
		delete(port.subscriber.subs, port.handle)
		port.subscriber = nil
	}
	port.orphanGen++
}

func (m *Manager) scheduleOrphanLocked(port *openPort) {
	if m.orphanTimeout == 0 {
		return
	}
	port.orphanGen++
	gen := port.orphanGen
	handle, path := port.handle, port.path
	time.AfterFunc(m.orphanTimeout, func() {
		m.orphanExpired(port, gen, handle, path)
	})
}

func (m *Manager) orphanExpired(port *openPort, gen uint64, handle, path string) {
	m.mu.Lock()
	if port.closed.Load() || port.orphanGen != gen || port.subscription != nil {
		m.mu.Unlock()
		return
	}
	m.removeLocked(port)
	conn := port.lastConn
	_, active := m.connections[conn]
	m.mu.Unlock()

	port.writeMu.Lock()
	closeErr := port.port.Close()
	port.writeMu.Unlock()
	if closeErr != nil {
		m.logger.Warn("close orphaned serial port failed", "path", path, "error", closeErr)
	}
	m.logger.Warn("closed serial port after orphan timeout", "path", path, "handle", handle,
		"orphanTimeout", m.orphanTimeout)
	if active {
		conn.sink.Closed(handle, protocol.ReasonOrphanTimeout,
			fmt.Sprintf("no subscriber for %s", m.orphanTimeout))
	}
}

func (m *Manager) readLoop(port *openPort) {
	data := make([]byte, 64<<10)
	for {
		n, err := port.port.Read(data)
		if n > 0 {
			port.buffer.Write(data[:n])
		}
		if err != nil {
			m.readFailed(port, err)
			return
		}
	}
}

func (m *Manager) readFailed(port *openPort, readErr error) {
	m.mu.Lock()
	if port.closed.Load() {
		m.mu.Unlock()
		return
	}
	reason := protocol.ReasonIOError
	if deviceRemoved(port.path, readErr) {
		reason = protocol.ReasonDeviceRemoved
	}
	handle := port.handle
	m.removeLocked(port)
	conn := port.lastConn
	_, active := m.connections[conn]
	m.mu.Unlock()

	port.writeMu.Lock()
	_ = port.port.Close()
	port.writeMu.Unlock()

	m.logger.Warn("serial port read failed", "path", port.path, "handle", handle,
		"reason", reason, "error", readErr)
	if active {
		conn.sink.Closed(handle, reason, readErr.Error())
	}
}

func deviceRemoved(path string, readErr error) bool {
	if errors.Is(readErr, syscall.EIO) || errors.Is(readErr, syscall.ENXIO) || errors.Is(readErr, syscall.ENODEV) {
		return true
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return true
	}
	return false
}

func convertSettings(settings protocol.SerialSettings) (serialport.Settings, error) {
	converted := serialport.Settings{
		BaudRate: settings.BaudRate,
		DataBits: settings.DataBits,
		StopBits: settings.StopBits,
	}
	switch settings.Parity {
	case "none":
		converted.Parity = serialport.ParityNone
	case "even":
		converted.Parity = serialport.ParityEven
	case "odd":
		converted.Parity = serialport.ParityOdd
	default:
		return serialport.Settings{}, protocol.Errorf(protocol.CodeInvalidParams, "unknown parity %q", settings.Parity)
	}
	switch settings.FlowControl {
	case "none":
		converted.FlowControl = serialport.FlowNone
	case "rtscts":
		converted.FlowControl = serialport.FlowRTSCTS
	case "xonxoff":
		converted.FlowControl = serialport.FlowXONXOFF
	default:
		return serialport.Settings{}, protocol.Errorf(protocol.CodeInvalidParams, "unknown flow control %q", settings.FlowControl)
	}
	return converted, nil
}

func serialError(err error, action string) *protocol.Error {
	switch {
	case errors.Is(err, serialport.ErrBusy):
		return protocol.Errorf(protocol.CodeBusy, "%s: %v", action, err)
	case errors.Is(err, serialport.ErrUnsupported):
		return protocol.Errorf(protocol.CodeUnsupported, "%s: %v", action, err)
	case errors.Is(err, os.ErrNotExist):
		return protocol.Errorf(protocol.CodeNotFound, "%s: %v", action, err)
	default:
		return protocol.Errorf(protocol.CodeIO, "%s: %v", action, err)
	}
}
