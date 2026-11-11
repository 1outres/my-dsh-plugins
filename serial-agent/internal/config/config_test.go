package config

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadDefaults(t *testing.T) {
	path := writeConfig(t, `{"server":"wss://dsh.example.net/remote-serial/agent"}`)
	cfg, err := Load(path, Overrides{})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "wss://dsh.example.net/remote-serial/agent" {
		t.Fatalf("server = %q", cfg.Server)
	}
	if len(cfg.Allow) == 0 {
		t.Fatal("default allow is empty")
	}
	if cfg.BufferBytes != DefaultBufferBytes {
		t.Fatalf("bufferBytes = %d", cfg.BufferBytes)
	}
	if cfg.OrphanTimeout != DefaultOrphanTimeout {
		t.Fatalf("orphanTimeout = %s", cfg.OrphanTimeout)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Fatalf("logLevel = %s", cfg.LogLevel)
	}
	if !filepath.IsAbs(cfg.IdentityFile) {
		t.Fatalf("identityFile = %q, want an absolute path", cfg.IdentityFile)
	}
}

func TestLoadExplicitValues(t *testing.T) {
	path := writeConfig(t, `{
		"server": "ws://127.0.0.1:8080/remote-serial/agent",
		"identityFile": "/tmp/id",
		"allow": ["/dev/ttyUSB*"],
		"bufferBytes": 8192,
		"orphanTimeout": "0s",
		"logLevel": "debug"
	}`)
	cfg, err := Load(path, Overrides{})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.IdentityFile != "/tmp/id" || len(cfg.Allow) != 1 || cfg.BufferBytes != 8192 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.OrphanTimeout != 0 {
		t.Fatalf("orphanTimeout = %s, want 0", cfg.OrphanTimeout)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("logLevel = %s", cfg.LogLevel)
	}
}

func TestOverridesWin(t *testing.T) {
	path := writeConfig(t, `{"server":"wss://one.example/agent","identityFile":"/tmp/one"}`)
	cfg, err := Load(path, Overrides{Server: "wss://two.example/agent", IdentityFile: "/tmp/two"})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "wss://two.example/agent" || cfg.IdentityFile != "/tmp/two" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestLoadRejectsUnknownField(t *testing.T) {
	path := writeConfig(t, `{"server":"wss://example.test/agent","nope":1}`)
	_, err := Load(path, Overrides{})
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("got %v, want an unknown field error", err)
	}
}

func TestLoadRejectsEmptyAllow(t *testing.T) {
	path := writeConfig(t, `{"server":"wss://example.test/agent","allow":[]}`)
	if _, err := Load(path, Overrides{}); err == nil {
		t.Fatal("expected an empty allow error")
	}
}

func TestLoadRejectsBadBufferSize(t *testing.T) {
	for _, value := range []int{4095, 64<<20 + 1} {
		path := writeConfig(t, `{"server":"wss://example.test/agent","bufferBytes":`+strconv.Itoa(value)+`}`)
		if _, err := Load(path, Overrides{}); err == nil {
			t.Fatalf("expected an error for bufferBytes %d", value)
		}
	}
}

func TestLoadRejectsBadOrphanTimeout(t *testing.T) {
	for _, value := range []string{"soon", "-1s"} {
		path := writeConfig(t, `{"server":"wss://example.test/agent","orphanTimeout":"`+value+`"}`)
		if _, err := Load(path, Overrides{}); err == nil {
			t.Fatalf("expected an error for orphanTimeout %q", value)
		}
	}
}

func TestLoadRejectsBadLogLevel(t *testing.T) {
	path := writeConfig(t, `{"server":"wss://example.test/agent","logLevel":"trace"}`)
	if _, err := Load(path, Overrides{}); err == nil {
		t.Fatal("expected a logLevel error")
	}
}

func TestValidateServer(t *testing.T) {
	valid := []string{"ws://localhost:8080/x", "wss://dsh.example.net/remote-serial/agent"}
	for _, server := range valid {
		if err := ValidateServer(server); err != nil {
			t.Fatalf("ValidateServer(%q): %v", server, err)
		}
	}
	invalid := []string{"", "http://example.test/x", "wss://", "wss://example.test/x#frag", "://"}
	for _, server := range invalid {
		if err := ValidateServer(server); err == nil {
			t.Fatalf("ValidateServer(%q) succeeded", server)
		}
	}
}

func TestValidateAllow(t *testing.T) {
	if err := ValidateAllow([]string{"/dev/ttyUSB*", "/dev/serial/by-id/*"}); err != nil {
		t.Fatalf("ValidateAllow: %v", err)
	}
	for _, patterns := range [][]string{{}, {"dev/ttyUSB*"}, {"/dev/["}, {"/dev/../etc/passwd"}} {
		if err := ValidateAllow(patterns); err == nil {
			t.Fatalf("ValidateAllow(%v) succeeded", patterns)
		}
	}
}

func TestWarnings(t *testing.T) {
	cases := []struct {
		server   string
		expected bool
	}{
		{"ws://127.0.0.1:8080/x", false},
		{"ws://localhost:8080/x", false},
		{"ws://[::1]:8080/x", false},
		{"ws://10.0.0.5:8080/x", true},
		{"wss://10.0.0.5/x", false},
	}
	for _, test := range cases {
		cfg := &Config{Server: test.server}
		warnings := cfg.Warnings()
		if got := len(warnings) > 0; got != test.expected {
			t.Fatalf("Warnings(%q) = %v, want warning=%v", test.server, warnings, test.expected)
		}
	}
}

func getenv(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func homeDir(dir string) func() (string, error) {
	return func() (string, error) { return dir, nil }
}

func noHome() (string, error) {
	return "", errors.New("$HOME is not defined")
}

func TestIdentityFileFor(t *testing.T) {
	path, err := identityFileFor("linux", getenv(map[string]string{"STATE_DIRECTORY": "/var/lib/dsh-serial-agent:/run/x"}), homeDir("/home/u"))
	if err != nil || path != "/var/lib/dsh-serial-agent/identity" {
		t.Fatalf("STATE_DIRECTORY path = %q, %v", path, err)
	}
	path, err = identityFileFor("linux", getenv(map[string]string{"XDG_STATE_HOME": "/state"}), homeDir("/home/u"))
	if err != nil || path != "/state/dsh-serial-agent/identity" {
		t.Fatalf("XDG_STATE_HOME path = %q, %v", path, err)
	}
	path, err = identityFileFor("linux", getenv(map[string]string{}), homeDir("/home/u"))
	if err != nil || path != "/home/u/.local/state/dsh-serial-agent/identity" {
		t.Fatalf("home path = %q, %v", path, err)
	}
	path, err = identityFileFor("darwin", getenv(map[string]string{}), homeDir("/Users/u"))
	if err != nil || path != "/Users/u/Library/Application Support/dsh-serial-agent/identity" {
		t.Fatalf("darwin path = %q, %v", path, err)
	}
	if _, err := identityFileFor("plan9", getenv(map[string]string{}), homeDir("/home/u")); err == nil {
		t.Fatal("expected an unsupported OS error")
	}
}

func TestIdentityFileForStateDirectoryWithoutHome(t *testing.T) {
	path, err := identityFileFor("linux", getenv(map[string]string{"STATE_DIRECTORY": "/var/lib/dsh-serial-agent:/run/x"}), noHome)
	if err != nil || path != "/var/lib/dsh-serial-agent/identity" {
		t.Fatalf("STATE_DIRECTORY path = %q, %v", path, err)
	}
}

func TestIdentityFileForXDGStateHomeWithoutHome(t *testing.T) {
	path, err := identityFileFor("linux", getenv(map[string]string{"XDG_STATE_HOME": "/state"}), noHome)
	if err != nil || path != "/state/dsh-serial-agent/identity" {
		t.Fatalf("XDG_STATE_HOME path = %q, %v", path, err)
	}
}

func TestIdentityFileForLinuxWithoutHome(t *testing.T) {
	_, err := identityFileFor("linux", getenv(map[string]string{}), noHome)
	if err == nil || !strings.Contains(err.Error(), "identityFile") {
		t.Fatalf("got %v, want an error that says to set identityFile", err)
	}
}

func TestIdentityFileForDarwinWithoutHome(t *testing.T) {
	_, err := identityFileFor("darwin", getenv(map[string]string{}), noHome)
	if err == nil || !strings.Contains(err.Error(), "identityFile") {
		t.Fatalf("got %v, want an error that says to set identityFile", err)
	}
}

func TestDefaultAllowByOS(t *testing.T) {
	for _, goos := range []string{"linux", "darwin"} {
		patterns, err := defaultAllow(goos)
		if err != nil || len(patterns) == 0 {
			t.Fatalf("defaultAllow(%q) = %v, %v", goos, patterns, err)
		}
		if err := ValidateAllow(patterns); err != nil {
			t.Fatalf("defaultAllow(%q) is invalid: %v", goos, err)
		}
	}
	if _, err := defaultAllow("plan9"); err == nil {
		t.Fatal("expected an unsupported OS error")
	}
}

func TestParseDurationDefault(t *testing.T) {
	if DefaultOrphanTimeout != time.Hour {
		t.Fatalf("DefaultOrphanTimeout = %s", DefaultOrphanTimeout)
	}
}
