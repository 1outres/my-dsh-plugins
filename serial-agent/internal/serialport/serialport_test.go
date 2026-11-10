//go:build linux || darwin

package serialport

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

type testPty struct {
	master *os.File
	path   string
}

func openTestPty(t *testing.T) testPty {
	t.Helper()
	master, slave, err := pty.Open()
	if err != nil {
		if ptyUnavailable(err) {
			t.Skipf("pseudo terminals are not available in this environment: %v", err)
		}
		t.Fatalf("pty.Open: %v", err)
	}
	t.Cleanup(func() {
		_ = master.Close()
		_ = slave.Close()
	})
	return testPty{master: master, path: slave.Name()}
}

func ptyUnavailable(err error) bool {
	for _, target := range []error{syscall.ENOENT, syscall.ENODEV, syscall.ENXIO, syscall.EACCES, syscall.EPERM} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

func testSettings() Settings {
	return Settings{BaudRate: 115200, DataBits: 8, Parity: ParityNone, StopBits: 1, FlowControl: FlowNone}
}

func openTestPort(t *testing.T, path string, settings Settings) *port {
	t.Helper()
	opened, err := SystemOpener{}.Open(path, settings)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	open, ok := opened.(*port)
	if !ok {
		t.Fatalf("Open returned %T, want *port", opened)
	}
	t.Cleanup(func() { _ = open.Close() })
	return open
}

func TestOpenAppliesRawMode(t *testing.T) {
	device := openTestPty(t)
	open := openTestPort(t, device.path, testSettings())
	termios := readTermios(t, open)

	if termios.Iflag&(unix.IXON|unix.IXOFF|unix.IXANY|unix.ICRNL|unix.IXON) != 0 {
		t.Fatalf("input flags %#x still contain line or flow handling", termios.Iflag)
	}
	if termios.Oflag&unix.OPOST != 0 {
		t.Fatalf("output flags %#x still contain OPOST", termios.Oflag)
	}
	if termios.Lflag&(unix.ICANON|unix.ECHO|unix.ISIG|unix.IEXTEN) != 0 {
		t.Fatalf("local flags %#x are not raw", termios.Lflag)
	}
	if termios.Cflag&unix.CLOCAL == 0 || termios.Cflag&unix.CREAD == 0 {
		t.Fatalf("control flags %#x lack CLOCAL or CREAD", termios.Cflag)
	}
	if termios.Cflag&unix.CSIZE != unix.CS8 {
		t.Fatalf("data bits mask = %#x, want CS8", termios.Cflag&unix.CSIZE)
	}
	if termios.Cflag&(unix.PARENB|unix.PARODD|unix.CSTOPB|unix.CRTSCTS) != 0 {
		t.Fatalf("control flags %#x contain parity, stop or flow bits", termios.Cflag)
	}
	if termios.Cc[unix.VMIN] != 1 || termios.Cc[unix.VTIME] != 0 {
		t.Fatalf("VMIN,VTIME = %d,%d, want 1,0", termios.Cc[unix.VMIN], termios.Cc[unix.VTIME])
	}
}

// A pseudo terminal has no UART, so the kernel forces CS8 without parity
// and ignores these two fields. Check them on the termios struct instead.
func TestConfigureTermiosAppliesDataBits(t *testing.T) {
	cases := []struct {
		bits int
		want uint64
	}{
		{5, uint64(unix.CS5)},
		{6, uint64(unix.CS6)},
		{7, uint64(unix.CS7)},
		{8, uint64(unix.CS8)},
	}
	for _, testCase := range cases {
		t.Run(strconv.Itoa(testCase.bits), func(t *testing.T) {
			settings := testSettings()
			settings.DataBits = testCase.bits
			termios := &unix.Termios{}
			configureTermios(termios, settings)
			if got := uint64(termios.Cflag & unix.CSIZE); got != testCase.want {
				t.Fatalf("data bits mask = %#x, want %#x", got, testCase.want)
			}
		})
	}
}

func TestConfigureTermiosAppliesParity(t *testing.T) {
	cases := []struct {
		name    string
		parity  Parity
		enabled bool
		odd     bool
	}{
		{"none", ParityNone, false, false},
		{"even", ParityEven, true, false},
		{"odd", ParityOdd, true, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			settings := testSettings()
			settings.Parity = testCase.parity
			termios := &unix.Termios{}
			configureTermios(termios, settings)
			if enabled := termios.Cflag&unix.PARENB != 0; enabled != testCase.enabled {
				t.Fatalf("PARENB = %v, want %v", enabled, testCase.enabled)
			}
			if odd := termios.Cflag&unix.PARODD != 0; odd != testCase.odd {
				t.Fatalf("PARODD = %v, want %v", odd, testCase.odd)
			}
		})
	}
}

func TestOpenAppliesStopBits(t *testing.T) {
	cases := []struct {
		bits int
		want bool
	}{{1, false}, {2, true}}
	for _, testCase := range cases {
		t.Run(strconv.Itoa(testCase.bits), func(t *testing.T) {
			device := openTestPty(t)
			settings := testSettings()
			settings.StopBits = testCase.bits
			open := openTestPort(t, device.path, settings)
			termios := readTermios(t, open)
			if got := termios.Cflag&unix.CSTOPB != 0; got != testCase.want {
				t.Fatalf("CSTOPB = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestOpenAppliesFlowControl(t *testing.T) {
	t.Run("rtscts", func(t *testing.T) {
		device := openTestPty(t)
		settings := testSettings()
		settings.FlowControl = FlowRTSCTS
		open := openTestPort(t, device.path, settings)
		termios := readTermios(t, open)
		if termios.Cflag&unix.CRTSCTS == 0 {
			t.Fatalf("control flags %#x lack CRTSCTS", termios.Cflag)
		}
		if termios.Iflag&(unix.IXON|unix.IXOFF) != 0 {
			t.Fatalf("input flags %#x enable XON/XOFF", termios.Iflag)
		}
	})

	t.Run("xonxoff", func(t *testing.T) {
		device := openTestPty(t)
		settings := testSettings()
		settings.FlowControl = FlowXONXOFF
		open := openTestPort(t, device.path, settings)
		termios := readTermios(t, open)
		if termios.Iflag&unix.IXON == 0 || termios.Iflag&unix.IXOFF == 0 {
			t.Fatalf("input flags %#x lack IXON or IXOFF", termios.Iflag)
		}
		if termios.Iflag&unix.IXANY != 0 {
			t.Fatalf("input flags %#x enable IXANY", termios.Iflag)
		}
		if termios.Cflag&unix.CRTSCTS != 0 {
			t.Fatalf("control flags %#x enable CRTSCTS", termios.Cflag)
		}
	})

	t.Run("none", func(t *testing.T) {
		device := openTestPty(t)
		open := openTestPort(t, device.path, testSettings())
		termios := readTermios(t, open)
		if termios.Iflag&(unix.IXON|unix.IXOFF) != 0 || termios.Cflag&unix.CRTSCTS != 0 {
			t.Fatalf("flow control is still enabled: iflag %#x cflag %#x", termios.Iflag, termios.Cflag)
		}
	})
}

func TestOpenAppliesBaudRate(t *testing.T) {
	for _, baud := range []int{9600, 19200, 115200} {
		t.Run(strconv.Itoa(baud), func(t *testing.T) {
			device := openTestPty(t)
			settings := testSettings()
			settings.BaudRate = baud
			open := openTestPort(t, device.path, settings)
			if got := termiosBaudRate(t, readTermios(t, open)); got != baud {
				t.Fatalf("baud rate = %d, want %d", got, baud)
			}
		})
	}
}

func TestSetSettingsUpdatesOpenPort(t *testing.T) {
	device := openTestPty(t)
	open := openTestPort(t, device.path, testSettings())
	settings := Settings{BaudRate: 9600, DataBits: 7, Parity: ParityEven, StopBits: 2, FlowControl: FlowRTSCTS}
	if err := open.SetSettings(settings); err != nil {
		t.Fatalf("SetSettings: %v", err)
	}
	termios := readTermios(t, open)
	if termios.Cflag&unix.CSTOPB == 0 {
		t.Fatalf("control flags %#x lack CSTOPB", termios.Cflag)
	}
	if termios.Cflag&unix.CRTSCTS == 0 {
		t.Fatalf("control flags %#x lack CRTSCTS", termios.Cflag)
	}
	if got := termiosBaudRate(t, termios); got != 9600 {
		t.Fatalf("baud rate = %d, want 9600", got)
	}
}

func TestReadAndWriteUseTheDevice(t *testing.T) {
	device := openTestPty(t)
	open := openTestPort(t, device.path, testSettings())

	read := make(chan struct {
		text string
		err  error
	}, 1)
	go func() {
		buffer := make([]byte, 5)
		n, err := open.Read(buffer)
		read <- struct {
			text string
			err  error
		}{text: string(buffer[:n]), err: err}
	}()

	if _, err := device.master.Write([]byte("hello")); err != nil {
		t.Fatalf("write to the pseudo terminal: %v", err)
	}
	select {
	case got := <-read:
		if got.err != nil || got.text != "hello" {
			t.Fatalf("Read = %q, %v; want %q, nil", got.text, got.err, "hello")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Read did not return")
	}

	if _, err := open.Write([]byte("world")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if err := device.master.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	buffer := make([]byte, 5)
	if _, err := io.ReadFull(device.master, buffer); err != nil {
		t.Fatalf("read from the pseudo terminal: %v", err)
	}
	if string(buffer) != "world" {
		t.Fatalf("pseudo terminal received %q, want %q", buffer, "world")
	}
}

func TestCloseUnblocksPendingRead(t *testing.T) {
	device := openTestPty(t)
	open := openTestPort(t, device.path, testSettings())

	done := make(chan error, 1)
	go func() {
		buffer := make([]byte, 1)
		_, err := open.Read(buffer)
		done <- err
	}()
	time.Sleep(50 * time.Millisecond)

	if err := open.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, ErrClosed) {
			t.Fatalf("Read after Close = %v, want ErrClosed", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not unblock Read")
	}
	if err := open.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

func TestCloseReleasesExclusiveAccess(t *testing.T) {
	device := openTestPty(t)
	open := openTestPort(t, device.path, testSettings())
	if err := open.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	reopened, err := SystemOpener{}.Open(device.path, testSettings())
	if err != nil {
		t.Fatalf("Open after Close: %v", err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatalf("Close reopened port: %v", err)
	}
}

func TestBreakOnPseudoTerminal(t *testing.T) {
	device := openTestPty(t)
	open := openTestPort(t, device.path, testSettings())
	if err := open.Break(20 * time.Millisecond); err != nil {
		if errors.Is(err, ErrUnsupported) {
			t.Logf("the pseudo terminal refuses BREAK: %v", err)
			return
		}
		t.Fatalf("Break: %v", err)
	}
}

func TestOpenMapsBusy(t *testing.T) {
	device := openTestPty(t)
	openTestPort(t, device.path, testSettings())
	_, err := SystemOpener{}.Open(device.path, testSettings())
	if !errors.Is(err, ErrBusy) {
		t.Fatalf("second Open = %v, want ErrBusy", err)
	}
}

func TestOpenMapsMissingDevice(t *testing.T) {
	_, err := SystemOpener{}.Open(filepath.Join(t.TempDir(), "missing"), testSettings())
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Open = %v, want os.ErrNotExist", err)
	}
}

func TestOpenRejectsInvalidSettings(t *testing.T) {
	cases := []struct {
		name     string
		settings Settings
	}{
		{"baud rate", Settings{BaudRate: 0, DataBits: 8, Parity: ParityNone, StopBits: 1}},
		{"data bits", Settings{BaudRate: 9600, DataBits: 9, Parity: ParityNone, StopBits: 1}},
		{"parity", Settings{BaudRate: 9600, DataBits: 8, Parity: Parity(9), StopBits: 1}},
		{"stop bits", Settings{BaudRate: 9600, DataBits: 8, Parity: ParityNone, StopBits: 3}},
		{"flow control", Settings{BaudRate: 9600, DataBits: 8, Parity: ParityNone, StopBits: 1, FlowControl: FlowControl(9)}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := SystemOpener{}.Open(filepath.Join(t.TempDir(), "missing"), testCase.settings)
			if !errors.Is(err, ErrUnsupported) {
				t.Fatalf("Open = %v, want ErrUnsupported", err)
			}
		})
	}
}
