//go:build !linux && !darwin

package serialport

import "fmt"

// SystemOpener reports that this platform has no serial driver here.
type SystemOpener struct{}

// Open reports ErrUnsupported on platforms without a serial driver.
func (SystemOpener) Open(_ string, settings Settings) (Port, error) {
	if err := validateSettings(settings); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("%w: serial ports are not supported on this platform", ErrUnsupported)
}
