package manager

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/ports"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/serialport"
)

type fakePort struct {
	reads  chan []byte
	errs   chan error
	closed chan struct{}

	closeOnce sync.Once
	mu        sync.Mutex
	written   []byte
	settings  serialport.Settings
	breaks    []time.Duration
	writeErr  error
	readErr   error
}

func newFakePort(settings serialport.Settings) *fakePort {
	return &fakePort{
		reads:    make(chan []byte, 16),
		errs:     make(chan error, 1),
		closed:   make(chan struct{}),
		settings: settings,
	}
}

func (p *fakePort) Read(buffer []byte) (int, error) {
	select {
	case chunk := <-p.reads:
		return copy(buffer, chunk), nil
	case err := <-p.errs:
		return 0, err
	case <-p.closed:
		return 0, os.ErrClosed
	}
}

func (p *fakePort) Write(buffer []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.writeErr != nil {
		return 0, p.writeErr
	}
	p.written = append(p.written, buffer...)
	return len(buffer), nil
}

func (p *fakePort) Break(duration time.Duration) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.breaks = append(p.breaks, duration)
	return nil
}

func (p *fakePort) SetSettings(settings serialport.Settings) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.settings = settings
	return nil
}

func (p *fakePort) Close() error {
	p.closeOnce.Do(func() { close(p.closed) })
	return nil
}

func (p *fakePort) writtenBytes() []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]byte(nil), p.written...)
}

func (p *fakePort) currentSettings() serialport.Settings {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.settings
}

func (p *fakePort) breakDurations() []time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]time.Duration(nil), p.breaks...)
}

type fakeOpener struct {
	mu    sync.Mutex
	ports map[string]*fakePort
	err   error
}

func newFakeOpener() *fakeOpener {
	return &fakeOpener{ports: make(map[string]*fakePort)}
}

func (o *fakeOpener) Open(path string, settings serialport.Settings) (serialport.Port, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.err != nil {
		return nil, o.err
	}
	port := newFakePort(settings)
	o.ports[path] = port
	return port, nil
}

func (o *fakeOpener) port(path string) *fakePort {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.ports[path]
}

type recordedEvent struct {
	kind   string
	handle string
	offset int64
	data   []byte
	reason string
}

type recordSink struct {
	mu     sync.Mutex
	events []recordedEvent
	order  []string
	closed chan recordedEvent
}

func newRecordSink() *recordSink {
	return &recordSink{closed: make(chan recordedEvent, 8)}
}

func (s *recordSink) Data(handle string, offset int64, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, recordedEvent{kind: "data", handle: handle, offset: offset, data: append([]byte(nil), data...)})
	s.order = append(s.order, "data")
}

func (s *recordSink) Closed(handle, reason, message string) {
	event := recordedEvent{kind: "closed", handle: handle, reason: reason, data: []byte(message)}
	s.mu.Lock()
	s.events = append(s.events, event)
	s.order = append(s.order, "closed")
	s.mu.Unlock()
	select {
	case s.closed <- event:
	default:
	}
}

func (s *recordSink) snapshot() []recordedEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedEvent(nil), s.events...)
}

func (s *recordSink) record(kind string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.order = append(s.order, kind)
}

func (s *recordSink) recordedOrder() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.order...)
}

func newTestManager(t *testing.T, opener serialport.Opener, orphanTimeout time.Duration) *Manager {
	t.Helper()
	manager, err := New(Options{
		Allow:         ports.New([]string{"/dev/null", "/dev/zero"}),
		Opener:        opener,
		BufferBytes:   4096,
		OrphanTimeout: orphanTimeout,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return manager
}

func testSettings(baud int) protocol.SerialSettings {
	return protocol.SerialSettings{BaudRate: baud, DataBits: 8, Parity: "none", StopBits: 1, FlowControl: "none"}
}

func waitFor(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition was not met in time")
}

func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var coded *protocol.Error
	if !errors.As(err, &coded) {
		t.Fatalf("got %v, want a protocol error", err)
	}
	if coded.Code != code {
		t.Fatalf("code = %q, want %q (%s)", coded.Code, code, coded.Message)
	}
}

func TestOpenReuseWriteBreakClose(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 0)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	defer manager.CloseConnection(conn)

	first, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if first.Handle != "p1" || first.Reused || first.Start != 0 || first.End != 0 {
		t.Fatalf("unexpected open result: %+v", first)
	}
	second, err := manager.Open(conn, "/dev/../dev/null", testSettings(115200))
	if err != nil {
		t.Fatalf("Open again: %v", err)
	}
	if second.Handle != first.Handle || !second.Reused {
		t.Fatalf("unexpected reuse result: %+v", second)
	}
	if got := opener.port("/dev/null").currentSettings().BaudRate; got != 115200 {
		t.Fatalf("baudRate = %d, want 115200", got)
	}

	written, err := manager.Write(first.Handle, []byte("hello"))
	if err != nil || written != 5 {
		t.Fatalf("Write = %d, %v", written, err)
	}
	if string(opener.port("/dev/null").writtenBytes()) != "hello" {
		t.Fatal("bytes did not reach the port")
	}
	if err := manager.Break(first.Handle, 100*time.Millisecond); err != nil {
		t.Fatalf("Break: %v", err)
	}
	if breaks := opener.port("/dev/null").breakDurations(); len(breaks) != 1 || breaks[0] != 100*time.Millisecond {
		t.Fatalf("breaks = %v", breaks)
	}
	if err := manager.ClosePort(first.Handle); err != nil {
		t.Fatalf("ClosePort: %v", err)
	}
	_, err = manager.Write(first.Handle, []byte("x"))
	requireCode(t, err, protocol.CodeUnknownHandle)
}

func TestSubscribeBacklogThenLiveAndDetach(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 0)
	defer manager.CloseAll()
	sink := newRecordSink()
	conn := manager.NewConnection(sink)

	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	opener.port("/dev/null").reads <- []byte("abc")
	waitFor(t, func() bool {
		_, end := manager.byHandle[opened.Handle].buffer.Bounds()
		return end == 3
	})

	var readyFrom, readyLost int64
	if err := manager.Subscribe(conn, opened.Handle, 0, func(from, lost int64) {
		sink.record("ready")
		readyFrom, readyLost = from, lost
	}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	order := sink.recordedOrder()
	if len(order) != 2 || order[0] != "data" || order[1] != "ready" {
		t.Fatalf("backlog was not delivered before the response: %v", order)
	}
	if readyFrom != 0 || readyLost != 0 {
		t.Fatalf("ready = %d,%d, want 0,0", readyFrom, readyLost)
	}

	opener.port("/dev/null").reads <- []byte("def")
	waitFor(t, func() bool { return len(sink.snapshot()) == 2 })
	events := sink.snapshot()
	if events[1].offset != 3 || string(events[1].data) != "def" {
		t.Fatalf("unexpected live event: %+v", events[1])
	}

	manager.CloseConnection(conn)
	if _, ok := manager.byHandle[opened.Handle]; !ok {
		t.Fatal("the port must stay open after the connection ends")
	}
	opener.port("/dev/null").reads <- []byte("ghi")
	time.Sleep(30 * time.Millisecond)
	if got := len(sink.snapshot()); got != 2 {
		t.Fatalf("events after detach: %d", got)
	}
}

func TestSubscribeReportsLostBytes(t *testing.T) {
	opener := newFakeOpener()
	manager, err := New(Options{
		Allow:         ports.New([]string{"/dev/null"}),
		Opener:        opener,
		BufferBytes:   8,
		OrphanTimeout: 0,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.CloseAll()
	sink := newRecordSink()
	conn := manager.NewConnection(sink)
	defer manager.CloseConnection(conn)

	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatal(err)
	}
	opener.port("/dev/null").reads <- []byte("0123456789")
	waitFor(t, func() bool {
		start, _ := manager.byHandle[opened.Handle].buffer.Bounds()
		return start == 2
	})

	var gotFrom, gotLost int64
	if err := manager.Subscribe(conn, opened.Handle, 0, func(from, lost int64) {
		gotFrom, gotLost = from, lost
	}); err != nil {
		t.Fatal(err)
	}
	if gotFrom != 2 || gotLost != 2 {
		t.Fatalf("from,lost = %d,%d, want 2,2", gotFrom, gotLost)
	}
	events := sink.snapshot()
	if len(events) != 1 || events[0].offset != 2 || string(events[0].data) != "23456789" {
		t.Fatalf("unexpected backlog: %+v", events)
	}
}

func TestOrphanTimeoutClosesPort(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 40*time.Millisecond)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	defer manager.CloseConnection(conn)

	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatal(err)
	}
	port := opener.port("/dev/null")
	select {
	case <-port.closed:
	case <-time.After(3 * time.Second):
		t.Fatal("the port was not closed after the orphan timeout")
	}
	waitFor(t, func() bool {
		_, ok := manager.byHandle[opened.Handle]
		return !ok
	})
}

func TestOrphanTimeoutAfterUnsubscribeSendsEvent(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 40*time.Millisecond)
	defer manager.CloseAll()
	sink := newRecordSink()
	conn := manager.NewConnection(sink)
	defer manager.CloseConnection(conn)

	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Subscribe(conn, opened.Handle, 0, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)
	if _, ok := manager.byHandle[opened.Handle]; !ok {
		t.Fatal("a subscribed port must not be closed by the orphan timeout")
	}
	if err := manager.Unsubscribe(conn, opened.Handle); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-sink.closed:
		if event.reason != protocol.ReasonOrphanTimeout {
			t.Fatalf("reason = %q", event.reason)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no closed event")
	}
}

func TestReadFailureSendsClosedEvent(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 0)
	defer manager.CloseAll()
	sink := newRecordSink()
	conn := manager.NewConnection(sink)
	defer manager.CloseConnection(conn)

	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Subscribe(conn, opened.Handle, 0, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	opener.port("/dev/null").errs <- syscall.EIO
	select {
	case event := <-sink.closed:
		if event.reason != protocol.ReasonDeviceRemoved {
			t.Fatalf("reason = %q", event.reason)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no closed event")
	}
	_, err = manager.Write(opened.Handle, []byte("x"))
	requireCode(t, err, protocol.CodeUnknownHandle)
}

func TestUnknownHandle(t *testing.T) {
	manager := newTestManager(t, newFakeOpener(), 0)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	defer manager.CloseConnection(conn)

	requireCode(t, manager.Subscribe(conn, "p9", 0, func(int64, int64) {}), protocol.CodeUnknownHandle)
	requireCode(t, manager.Unsubscribe(conn, "p9"), protocol.CodeUnknownHandle)
	_, err := manager.Write("p9", nil)
	requireCode(t, err, protocol.CodeUnknownHandle)
	requireCode(t, manager.Break("p9", time.Millisecond), protocol.CodeUnknownHandle)
	requireCode(t, manager.ClosePort("p9"), protocol.CodeUnknownHandle)
}

func TestClosedConnectionIsRejected(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 0)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatal(err)
	}
	manager.CloseConnection(conn)

	requireCode(t, manager.Subscribe(conn, opened.Handle, 0, func(int64, int64) {}), protocol.CodeIO)
	requireCode(t, manager.Unsubscribe(conn, opened.Handle), protocol.CodeIO)
	if _, err := manager.Open(conn, "/dev/zero", testSettings(9600)); err == nil {
		t.Fatal("expected an error for a closed connection")
	}
}

func TestOpenNotAllowed(t *testing.T) {
	manager := newTestManager(t, newFakeOpener(), 0)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	defer manager.CloseConnection(conn)

	_, err := manager.Open(conn, "/etc/passwd", testSettings(9600))
	requireCode(t, err, protocol.CodeNotAllowed)
}

func TestOpenBusyIsMapped(t *testing.T) {
	opener := newFakeOpener()
	opener.err = serialport.ErrBusy
	manager := newTestManager(t, opener, 0)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	defer manager.CloseConnection(conn)

	_, err := manager.Open(conn, "/dev/null", testSettings(9600))
	requireCode(t, err, protocol.CodeBusy)
}

func TestListIncludesOpenPorts(t *testing.T) {
	opener := newFakeOpener()
	manager := newTestManager(t, opener, 0)
	defer manager.CloseAll()
	conn := manager.NewConnection(newRecordSink())
	defer manager.CloseConnection(conn)

	opened, err := manager.Open(conn, "/dev/null", testSettings(9600))
	if err != nil {
		t.Fatal(err)
	}
	list, err := manager.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var found bool
	for _, info := range list {
		if info.Path == "/dev/null" {
			found = true
			if !info.Open || info.Handle != opened.Handle || info.Settings == nil || info.Settings.BaudRate != 9600 {
				t.Fatalf("unexpected info: %+v", info)
			}
		}
	}
	if !found {
		t.Fatalf("open port missing from %+v", list)
	}
}
