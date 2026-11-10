// Package config loads and validates the agent configuration file.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	DefaultBufferBytes   = 1 << 20
	MinBufferBytes       = 4096
	MaxBufferBytes       = 64 << 20
	DefaultOrphanTimeout = time.Hour
)

// Config is the validated configuration of one agent.
type Config struct {
	Server        string
	IdentityFile  string
	Allow         []string
	BufferBytes   int
	OrphanTimeout time.Duration
	LogLevel      slog.Level
}

// Overrides are command line values that win over the file.
type Overrides struct {
	Server       string
	IdentityFile string
}

type fileConfig struct {
	Server        string    `json:"server"`
	IdentityFile  *string   `json:"identityFile"`
	Allow         *[]string `json:"allow"`
	BufferBytes   *int      `json:"bufferBytes"`
	OrphanTimeout *string   `json:"orphanTimeout"`
	LogLevel      *string   `json:"logLevel"`
}

// Load reads path, applies defaults and overrides, and validates the result.
func Load(path string, overrides Overrides) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var file fileConfig
	if err := dec.Decode(&file); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse config %s: trailing data", path)
	}

	server := file.Server
	if overrides.Server != "" {
		server = overrides.Server
	}
	if err := ValidateServer(server); err != nil {
		return nil, fmt.Errorf("config %s: %w", path, err)
	}

	identityFile := ""
	switch {
	case overrides.IdentityFile != "":
		identityFile = overrides.IdentityFile
	case file.IdentityFile != nil && *file.IdentityFile != "":
		identityFile = *file.IdentityFile
	default:
		identityFile, err = DefaultIdentityFile()
		if err != nil {
			return nil, fmt.Errorf("config %s: %w", path, err)
		}
	}

	allow := file.Allow
	if allow == nil {
		defaults, err := defaultAllow(runtime.GOOS)
		if err != nil {
			return nil, fmt.Errorf("config %s: %w", path, err)
		}
		allow = &defaults
	}
	if err := ValidateAllow(*allow); err != nil {
		return nil, fmt.Errorf("config %s: %w", path, err)
	}

	bufferBytes := DefaultBufferBytes
	if file.BufferBytes != nil {
		bufferBytes = *file.BufferBytes
	}
	if bufferBytes < MinBufferBytes || bufferBytes > MaxBufferBytes {
		return nil, fmt.Errorf("config %s: bufferBytes must be between %d and %d, got %d",
			path, MinBufferBytes, MaxBufferBytes, bufferBytes)
	}

	orphanTimeout := DefaultOrphanTimeout
	if file.OrphanTimeout != nil {
		orphanTimeout, err = time.ParseDuration(*file.OrphanTimeout)
		if err != nil {
			return nil, fmt.Errorf("config %s: orphanTimeout is not a duration: %w", path, err)
		}
		if orphanTimeout < 0 {
			return nil, fmt.Errorf("config %s: orphanTimeout must not be negative", path)
		}
	}

	level := slog.LevelInfo
	if file.LogLevel != nil {
		level, err = ParseLogLevel(*file.LogLevel)
		if err != nil {
			return nil, fmt.Errorf("config %s: %w", path, err)
		}
	}

	return &Config{
		Server:        server,
		IdentityFile:  identityFile,
		Allow:         *allow,
		BufferBytes:   bufferBytes,
		OrphanTimeout: orphanTimeout,
		LogLevel:      level,
	}, nil
}

// ValidateServer checks the WebSocket URL of the gateway.
func ValidateServer(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return errors.New("server is required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("server %q is not a URL: %w", raw, err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return fmt.Errorf("server %q must use scheme ws or wss", raw)
	}
	if u.Host == "" {
		return fmt.Errorf("server %q has no host", raw)
	}
	if u.Fragment != "" {
		return fmt.Errorf("server %q must not have a fragment", raw)
	}
	return nil
}

// ValidateAllow checks the device patterns.
func ValidateAllow(patterns []string) error {
	if len(patterns) == 0 {
		return errors.New("allow must not be empty")
	}
	for _, pattern := range patterns {
		if !filepath.IsAbs(pattern) {
			return fmt.Errorf("allow pattern %q must be absolute", pattern)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return fmt.Errorf("allow pattern %q is not valid: %w", pattern, err)
		}
		for _, element := range strings.Split(pattern, "/") {
			if element == ".." {
				return fmt.Errorf("allow pattern %q must not contain ..", pattern)
			}
		}
	}
	return nil
}

// ParseLogLevel maps a config value to a slog level.
func ParseLogLevel(value string) (slog.Level, error) {
	switch value {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("logLevel must be debug, info, warn, or error, got %q", value)
	}
}

// Warnings returns security notes about a valid configuration.
func (c *Config) Warnings() []string {
	u, err := url.Parse(c.Server)
	if err != nil || u.Scheme != "ws" {
		return nil
	}
	host := u.Hostname()
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return []string{fmt.Sprintf("server %s uses ws:// without TLS; make sure the network is trusted, for example a WireGuard mesh", c.Server)}
}

// DefaultIdentityFile returns the identity path for this OS and environment.
func DefaultIdentityFile() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find home directory for the default identity: %w", err)
	}
	return identityFileFor(runtime.GOOS, os.LookupEnv, home)
}

func identityFileFor(goos string, getenv func(string) (string, bool), home string) (string, error) {
	switch goos {
	case "linux":
		if state, ok := getenv("STATE_DIRECTORY"); ok && state != "" {
			first := strings.Split(state, ":")[0]
			return filepath.Join(first, "identity"), nil
		}
		if state, ok := getenv("XDG_STATE_HOME"); ok && state != "" {
			return filepath.Join(state, "dsh-serial-agent", "identity"), nil
		}
		return filepath.Join(home, ".local", "state", "dsh-serial-agent", "identity"), nil
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "dsh-serial-agent", "identity"), nil
	default:
		return "", fmt.Errorf("no default identity path for OS %q; set identityFile", goos)
	}
}

func defaultAllow(goos string) ([]string, error) {
	switch goos {
	case "linux":
		return []string{"/dev/ttyUSB*", "/dev/ttyACM*", "/dev/serial/by-id/*"}, nil
	case "darwin":
		return []string{
			"/dev/cu.usbserial*",
			"/dev/cu.usbmodem*",
			"/dev/cu.SLAB_USBtoUART*",
			"/dev/cu.wchusbserial*",
		}, nil
	default:
		return nil, fmt.Errorf("no default allow patterns for OS %q; set allow", goos)
	}
}
