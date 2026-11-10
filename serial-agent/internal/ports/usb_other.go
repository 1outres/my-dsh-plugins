//go:build !linux

package ports

import "github.com/1outres/my-dsh-plugins/serial-agent/internal/protocol"

func (e *Enumerator) usbInfo(string) *protocol.SerialUSBInfo {
	return nil
}
