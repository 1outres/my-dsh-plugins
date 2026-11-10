//go:build linux

package ports

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"
)

func (e *Enumerator) usbInfo(devicePath string) *protocol.SerialUSBInfo {
	resolved, err := e.evalLink(devicePath)
	if err != nil {
		return nil
	}
	dir := filepath.Join(e.sysfs, "class", "tty", filepath.Base(resolved), "device")
	root := filepath.Clean(e.sysfs)
	for {
		vendor, vendorOK := readAttribute(dir, "idVendor")
		product, productOK := readAttribute(dir, "idProduct")
		if vendorOK && productOK {
			vendorID, ok := normalizeHex(vendor)
			if !ok {
				return nil
			}
			productID, ok := normalizeHex(product)
			if !ok {
				return nil
			}
			info := &protocol.SerialUSBInfo{VendorID: vendorID, ProductID: productID}
			info.SerialNumber = readOptional(dir, "serial")
			info.Manufacturer = readOptional(dir, "manufacturer")
			info.Product = readOptional(dir, "product")
			return info
		}
		parent := filepath.Dir(dir)
		if dir == root || parent == dir || !strings.HasPrefix(parent, root) {
			return nil
		}
		dir = parent
	}
}

func readAttribute(dir, name string) (string, bool) {
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(data)), true
}

func readOptional(dir, name string) string {
	value, _ := readAttribute(dir, name)
	return value
}

func normalizeHex(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "0x")
	if value == "" || len(value) > 4 {
		return "", false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return "", false
		}
	}
	return strings.Repeat("0", 4-len(value)) + value, true
}
