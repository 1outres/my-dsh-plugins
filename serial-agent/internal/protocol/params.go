package protocol

import (
	"strings"
)

// SerialSettings is the line configuration of one port.
type SerialSettings struct {
	BaudRate    int    `json:"baudRate"`
	DataBits    int    `json:"dataBits"`
	Parity      string `json:"parity"`
	StopBits    int    `json:"stopBits"`
	FlowControl string `json:"flowControl"`
}

// Validate checks SerialSettings against PROTOCOL.md.
func (s SerialSettings) Validate() error {
	if s.BaudRate <= 0 {
		return Errorf(CodeInvalidParams, "baudRate must be a positive integer")
	}
	if s.DataBits < 5 || s.DataBits > 8 {
		return Errorf(CodeInvalidParams, "dataBits must be 5, 6, 7, or 8")
	}
	switch s.Parity {
	case "none", "even", "odd":
	default:
		return Errorf(CodeInvalidParams, "parity must be none, even, or odd")
	}
	if s.StopBits != 1 && s.StopBits != 2 {
		return Errorf(CodeInvalidParams, "stopBits must be 1 or 2")
	}
	switch s.FlowControl {
	case "none", "rtscts", "xonxoff":
	default:
		return Errorf(CodeInvalidParams, "flowControl must be none, rtscts, or xonxoff")
	}
	return nil
}

type SerialUSBInfo struct {
	VendorID     string `json:"vendorId"`
	ProductID    string `json:"productId"`
	SerialNumber string `json:"serialNumber,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
	Product      string `json:"product,omitempty"`
}

// PortInfo describes one device for ports.list.
type PortInfo struct {
	Path        string          `json:"path"`
	Description string          `json:"description,omitempty"`
	USB         *SerialUSBInfo  `json:"usb,omitempty"`
	Open        bool            `json:"open"`
	Handle      string          `json:"handle,omitempty"`
	Settings    *SerialSettings `json:"settings,omitempty"`
}

type PortsListParams struct{}

type PortsListResult struct {
	Ports []PortInfo `json:"ports"`
}

type PortOpenParams struct {
	Path     string         `json:"path"`
	Settings SerialSettings `json:"settings"`
}

type PortOpenResult struct {
	Handle string `json:"handle"`
	Reused bool   `json:"reused"`
	Start  int64  `json:"start"`
	End    int64  `json:"end"`
}

type PortSubscribeParams struct {
	Handle string `json:"handle"`
	From   int64  `json:"from"`
}

type PortSubscribeResult struct {
	From int64 `json:"from"`
	Lost int64 `json:"lost"`
}

type PortUnsubscribeParams struct {
	Handle string `json:"handle"`
}

type PortUnsubscribeResult struct{}

type PortWriteParams struct {
	Handle string `json:"handle"`
	Data   []byte `json:"data"`
}

type PortWriteResult struct {
	Written int `json:"written"`
}

type PortBreakParams struct {
	Handle     string `json:"handle"`
	DurationMs int    `json:"durationMs"`
}

type PortBreakResult struct{}

type PortCloseParams struct {
	Handle string `json:"handle"`
}

type PortCloseResult struct{}

// Validate checks PortOpenParams.
func (p PortOpenParams) Validate() error {
	if strings.TrimSpace(p.Path) == "" {
		return Errorf(CodeInvalidParams, "path must not be empty")
	}
	return p.Settings.Validate()
}

// Validate checks PortSubscribeParams.
func (p PortSubscribeParams) Validate() error {
	if p.Handle == "" {
		return Errorf(CodeInvalidParams, "handle must not be empty")
	}
	if p.From < 0 {
		return Errorf(CodeInvalidParams, "from must not be negative")
	}
	return nil
}

// Validate checks PortUnsubscribeParams.
func (p PortUnsubscribeParams) Validate() error {
	return validateHandle(p.Handle)
}

// Validate checks PortWriteParams.
func (p PortWriteParams) Validate() error {
	if err := validateHandle(p.Handle); err != nil {
		return err
	}
	if len(p.Data) > MaxWriteBytes {
		return Errorf(CodeInvalidParams, "data must be at most %d bytes", MaxWriteBytes)
	}
	return nil
}

// Validate checks PortBreakParams.
func (p PortBreakParams) Validate() error {
	if err := validateHandle(p.Handle); err != nil {
		return err
	}
	if p.DurationMs < MinBreakMs || p.DurationMs > MaxBreakMs {
		return Errorf(CodeInvalidParams, "durationMs must be between %d and %d", MinBreakMs, MaxBreakMs)
	}
	return nil
}

// Validate checks PortCloseParams.
func (p PortCloseParams) Validate() error {
	return validateHandle(p.Handle)
}

func validateHandle(handle string) error {
	if handle == "" {
		return Errorf(CodeInvalidParams, "handle must not be empty")
	}
	return nil
}
