//go:build linux

package ports

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestUSBInfoFromFakeSysfs(t *testing.T) {
	sysfs := t.TempDir()
	device := filepath.Join(t.TempDir(), "ttyUSB9")
	if err := os.WriteFile(device, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	interfaceDir := filepath.Join(sysfs, "class", "tty", "ttyUSB9")
	if err := os.MkdirAll(filepath.Join(interfaceDir, "device"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(interfaceDir, "idVendor"), "1D6B\n")
	writeFile(t, filepath.Join(interfaceDir, "idProduct"), "0x10\n")
	writeFile(t, filepath.Join(interfaceDir, "serial"), "SN-1\n")
	writeFile(t, filepath.Join(interfaceDir, "manufacturer"), "Acme\n")
	writeFile(t, filepath.Join(interfaceDir, "product"), "USB Serial\n")

	enumerator := NewWithSysfs([]string{device}, sysfs)
	info := enumerator.usbInfo(device)
	if info == nil {
		t.Fatal("no USB info")
	}
	if info.VendorID != "1d6b" || info.ProductID != "0010" {
		t.Fatalf("ids = %s:%s", info.VendorID, info.ProductID)
	}
	if info.SerialNumber != "SN-1" || info.Manufacturer != "Acme" || info.Product != "USB Serial" {
		t.Fatalf("unexpected info: %+v", info)
	}
	if description := enumerator.describe(device).Description; description != "USB Serial" {
		t.Fatalf("description = %q", description)
	}
}

func TestUSBInfoMissing(t *testing.T) {
	sysfs := t.TempDir()
	device := filepath.Join(t.TempDir(), "ttyS0")
	if err := os.WriteFile(device, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if info := NewWithSysfs(nil, sysfs).usbInfo(device); info != nil {
		t.Fatalf("got %+v, want nil", info)
	}
}

func TestNormalizeHex(t *testing.T) {
	cases := []struct {
		input    string
		expected string
		ok       bool
	}{
		{"1d6b", "1d6b", true},
		{"1D6B", "1d6b", true},
		{"0x10", "0010", true},
		{"10", "0010", true},
		{"", "", false},
		{"12345", "", false},
		{"zz", "", false},
	}
	for _, test := range cases {
		got, ok := normalizeHex(test.input)
		if got != test.expected || ok != test.ok {
			t.Fatalf("normalizeHex(%q) = %q, %v; want %q, %v", test.input, got, ok, test.expected, test.ok)
		}
	}
}
