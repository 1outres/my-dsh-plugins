// Package ports enumerates serial devices and enforces the allow list.
package ports

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
)

// Device is one serial port found on this machine.
type Device struct {
	Path        string
	Description string
	USB         *protocol.SerialUSBInfo
}

// Enumerator applies the allow list and reads USB details.
type Enumerator struct {
	allow    []string
	sysfs    string
	glob     func(string) ([]string, error)
	stat     func(string) (os.FileInfo, error)
	evalLink func(string) (string, error)
}

// New returns an enumerator for the given allow patterns.
func New(allow []string) *Enumerator {
	return NewWithSysfs(allow, "/sys")
}

// NewWithSysfs is New with a different sysfs root, for tests.
func NewWithSysfs(allow []string, sysfsRoot string) *Enumerator {
	return &Enumerator{
		allow:    allow,
		sysfs:    sysfsRoot,
		glob:     filepath.Glob,
		stat:     os.Stat,
		evalLink: filepath.EvalSymlinks,
	}
}

// CheckOpenPath applies the checks of port.open and returns the cleaned path.
// The order is: clean and require absolute, match the allow list, then require
// an existing character device.
func (e *Enumerator) CheckOpenPath(requested string) (string, error) {
	cleaned := filepath.Clean(requested)
	if !filepath.IsAbs(cleaned) {
		return "", protocol.Errorf(protocol.CodeNotAllowed, "path %q is not absolute", requested)
	}
	allowed := false
	for _, pattern := range e.allow {
		ok, err := path.Match(pattern, cleaned)
		if err != nil {
			return "", protocol.Errorf(protocol.CodeNotAllowed, "allow pattern %q is not valid: %v", pattern, err)
		}
		if ok {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", protocol.Errorf(protocol.CodeNotAllowed, "path %q does not match the allow patterns", cleaned)
	}
	info, err := e.stat(cleaned)
	if err != nil {
		return "", protocol.Errorf(protocol.CodeNotFound, "path %q: %v", cleaned, err)
	}
	if info.Mode()&os.ModeCharDevice == 0 {
		return "", protocol.Errorf(protocol.CodeNotFound, "path %q is not a character device", cleaned)
	}
	return cleaned, nil
}

// List returns the allowed devices and the given open paths, sorted by path.
func (e *Enumerator) List(openPaths []string) ([]Device, error) {
	found := make(map[string]Device)
	for _, pattern := range e.allow {
		matches, err := e.glob(pattern)
		if err != nil {
			return nil, fmt.Errorf("glob allow pattern %q: %w", pattern, err)
		}
		for _, match := range matches {
			if _, seen := found[match]; seen {
				continue
			}
			info, err := e.stat(match)
			if err != nil || info.Mode()&os.ModeCharDevice == 0 {
				continue
			}
			found[match] = e.describe(match)
		}
	}
	for _, open := range openPaths {
		if _, seen := found[open]; seen {
			continue
		}
		found[open] = e.describe(open)
	}

	devices := make([]Device, 0, len(found))
	for _, device := range found {
		devices = append(devices, device)
	}
	sort.Slice(devices, func(i, j int) bool { return devices[i].Path < devices[j].Path })
	return devices, nil
}

func (e *Enumerator) describe(path string) Device {
	device := Device{Path: path, USB: e.usbInfo(path)}
	switch {
	case device.USB != nil && device.USB.Product != "":
		device.Description = device.USB.Product
	case device.USB != nil && device.USB.Manufacturer != "":
		device.Description = device.USB.Manufacturer
	}
	return device
}
