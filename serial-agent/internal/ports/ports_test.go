package ports

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
)

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

func TestCheckOpenPath(t *testing.T) {
	enumerator := New([]string{"/dev/null"})
	cleaned, err := enumerator.CheckOpenPath("/dev/../dev/null")
	if err != nil {
		t.Fatalf("CheckOpenPath: %v", err)
	}
	if cleaned != "/dev/null" {
		t.Fatalf("cleaned = %q", cleaned)
	}

	_, err = enumerator.CheckOpenPath("dev/null")
	requireCode(t, err, protocol.CodeNotAllowed)

	_, err = enumerator.CheckOpenPath("/dev/../etc/passwd")
	requireCode(t, err, protocol.CodeNotAllowed)
}

func TestCheckOpenPathRejectsNonCharacterDevices(t *testing.T) {
	dir := t.TempDir()
	regular := filepath.Join(dir, "regular")
	if err := os.WriteFile(regular, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(regular, link); err != nil {
		t.Fatal(err)
	}
	enumerator := New([]string{filepath.Join(dir, "*")})

	_, err := enumerator.CheckOpenPath(regular)
	requireCode(t, err, protocol.CodeNotFound)

	_, err = enumerator.CheckOpenPath(link)
	requireCode(t, err, protocol.CodeNotFound)

	_, err = enumerator.CheckOpenPath(filepath.Join(dir, "missing"))
	requireCode(t, err, protocol.CodeNotFound)
}

func TestListKeepsCharacterDevicesAndOpenPorts(t *testing.T) {
	dir := t.TempDir()
	regular := filepath.Join(dir, "regular")
	if err := os.WriteFile(regular, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "serial")
	if err := os.Symlink("/dev/null", link); err != nil {
		t.Fatal(err)
	}

	devices, err := New([]string{filepath.Join(dir, "*")}).List([]string{"/dev/zero"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("got %d devices: %+v", len(devices), devices)
	}
	paths := map[string]bool{}
	for _, device := range devices {
		paths[device.Path] = true
	}
	if !paths["/dev/zero"] || !paths[link] {
		t.Fatalf("unexpected devices: %+v", devices)
	}
}
