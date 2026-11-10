//go:build darwin

package serialport

import (
	"testing"

	"golang.org/x/sys/unix"
)

func readTermios(t *testing.T, open *port) *unix.Termios {
	t.Helper()
	termios, err := unix.IoctlGetTermios(open.fd, unix.TIOCGETA)
	if err != nil {
		t.Fatalf("TIOCGETA: %v", err)
	}
	return termios
}

func termiosBaudRate(t *testing.T, termios *unix.Termios) int {
	t.Helper()
	if termios.Ispeed != termios.Ospeed {
		t.Fatalf("input and output speeds differ: %d, %d", termios.Ispeed, termios.Ospeed)
	}
	return int(termios.Ispeed)
}
