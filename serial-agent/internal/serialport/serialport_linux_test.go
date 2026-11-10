//go:build linux

package serialport

import (
	"testing"

	"golang.org/x/sys/unix"
)

func readTermios(t *testing.T, open *port) *unix.Termios {
	t.Helper()
	termios, err := unix.IoctlGetTermios(open.fd, unix.TCGETS2)
	if err != nil {
		t.Fatalf("TCGETS2: %v", err)
	}
	return termios
}

func termiosBaudRate(t *testing.T, termios *unix.Termios) int {
	t.Helper()
	if got := termios.Cflag & unix.CBAUD; got != unix.BOTHER {
		t.Fatalf("CBAUD = %#x, want BOTHER", got)
	}
	if termios.Ispeed != termios.Ospeed {
		t.Fatalf("input and output speeds differ: %d, %d", termios.Ispeed, termios.Ospeed)
	}
	return int(termios.Ispeed)
}

func TestOpenUsesBotherForNonStandardBaudRate(t *testing.T) {
	device := openTestPty(t)
	settings := testSettings()
	settings.BaudRate = 12345
	open := openTestPort(t, device.path, settings)
	if got := termiosBaudRate(t, readTermios(t, open)); got != 12345 {
		t.Fatalf("baud rate = %d, want 12345", got)
	}
}
