// Package serialport is the thin layer over the serial device driver.
package serialport

import (
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/unix"
)

// Parity is the parity setting of a port.
type Parity int

const (
	ParityNone Parity = iota
	ParityEven
	ParityOdd
)

// FlowControl is the flow control setting of a port.
type FlowControl int

const (
	FlowNone FlowControl = iota
	FlowRTSCTS
	FlowXONXOFF
)

// Settings are the line settings the manager applies to a port.
type Settings struct {
	BaudRate    int
	DataBits    int
	Parity      Parity
	StopBits    int
	FlowControl FlowControl
}

var (
	// ErrBusy reports a device that another process holds open.
	ErrBusy = errors.New("serial port is held by another process")
	// ErrUnsupported reports settings the driver cannot apply.
	ErrUnsupported = errors.New("serial settings are not supported")
	// ErrClosed reports a read or write on a port that Close has ended.
	ErrClosed = errors.New("serial port is closed")
)

// Port is one open serial device.
type Port interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Break(duration time.Duration) error
	SetSettings(settings Settings) error
	Close() error
}

// Opener opens serial devices. Tests replace it with a fake.
type Opener interface {
	Open(path string, settings Settings) (Port, error)
}

// SystemOpener opens serial devices with the operating system serial driver.
type SystemOpener struct{}

// Open opens path with exclusive access and the given line settings. The
// device stays non-blocking; Read waits with poll so Close can always stop it.
func (SystemOpener) Open(path string, settings Settings) (Port, error) {
	if err := validateSettings(settings); err != nil {
		return nil, err
	}
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_NOCTTY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, openError("open "+path, err)
	}
	if err := unix.IoctlSetInt(fd, unix.TIOCEXCL, 0); err != nil {
		_ = closeDevice(fd)
		return nil, openError("take exclusive access to "+path, err)
	}
	if err := applySettings(fd, settings); err != nil {
		_ = closeDevice(fd)
		return nil, err
	}
	wakeRead, wakeWrite, err := os.Pipe()
	if err != nil {
		_ = closeDevice(fd)
		return nil, fmt.Errorf("create close pipe for %s: %w", path, err)
	}
	return &port{fd: fd, wakeRead: wakeRead, wakeWrite: wakeWrite}, nil
}

type port struct {
	fd        int
	wakeRead  *os.File
	wakeWrite *os.File

	readMu    sync.Mutex
	fdMu      sync.RWMutex
	closed    atomic.Bool
	closeOnce sync.Once
	closeErr  error
}

// Read waits for input and copies it into p.
func (p *port) Read(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	p.readMu.Lock()
	defer p.readMu.Unlock()
	p.fdMu.RLock()
	defer p.fdMu.RUnlock()
	if p.closed.Load() {
		return 0, ErrClosed
	}
	for {
		readable, err := p.poll(unix.POLLIN)
		if err != nil {
			return 0, err
		}
		if !readable {
			return 0, ErrClosed
		}
		n, err := unix.Read(p.fd, buffer)
		switch {
		case errors.Is(err, unix.EINTR):
			continue
		case errors.Is(err, unix.EAGAIN):
			continue
		case err != nil:
			return 0, err
		case n == 0:
			// A Linux tty that lost its device stays readable with no data.
			return 0, io.EOF
		default:
			return n, nil
		}
	}
}

// Write sends p and waits until the device accepts it.
func (p *port) Write(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	p.fdMu.RLock()
	defer p.fdMu.RUnlock()
	if p.closed.Load() {
		return 0, ErrClosed
	}
	for {
		n, err := unix.Write(p.fd, buffer)
		switch {
		case errors.Is(err, unix.EINTR):
			continue
		case errors.Is(err, unix.EAGAIN):
			writable, waitErr := p.poll(unix.POLLOUT)
			if waitErr != nil {
				return 0, waitErr
			}
			if !writable {
				return 0, ErrClosed
			}
			continue
		default:
			return n, err
		}
	}
}

// Break holds the line in the BREAK state for duration and always ends it.
func (p *port) Break(duration time.Duration) error {
	p.fdMu.RLock()
	defer p.fdMu.RUnlock()
	if p.closed.Load() {
		return ErrClosed
	}
	if err := unix.IoctlSetInt(p.fd, unix.TIOCSBRK, 0); err != nil {
		return settingsError("start break", err)
	}
	time.Sleep(duration)
	if err := unix.IoctlSetInt(p.fd, unix.TIOCCBRK, 0); err != nil {
		return settingsError("end break", err)
	}
	return nil
}

// SetSettings applies new line settings to an open port.
func (p *port) SetSettings(settings Settings) error {
	if err := validateSettings(settings); err != nil {
		return err
	}
	p.fdMu.RLock()
	defer p.fdMu.RUnlock()
	if p.closed.Load() {
		return ErrClosed
	}
	return applySettings(p.fd, settings)
}

// Close stops pending reads and closes the device.
func (p *port) Close() error {
	p.closeOnce.Do(func() {
		p.closed.Store(true)
		if _, err := p.wakeWrite.Write([]byte{0}); err != nil {
			p.closeErr = errors.Join(p.closeErr, fmt.Errorf("signal close: %w", err))
		}
		// Wait for a poll in Read, so the descriptor cannot be reused under it.
		p.fdMu.Lock()
		if err := closeDevice(p.fd); err != nil {
			p.closeErr = errors.Join(p.closeErr, fmt.Errorf("close device: %w", err))
		}
		p.fdMu.Unlock()
		if err := p.wakeWrite.Close(); err != nil {
			p.closeErr = errors.Join(p.closeErr, fmt.Errorf("close close pipe: %w", err))
		}
		if err := p.wakeRead.Close(); err != nil {
			p.closeErr = errors.Join(p.closeErr, fmt.Errorf("close close pipe: %w", err))
		}
	})
	return p.closeErr
}

// poll waits until the device is ready or Close signals the wake pipe. It
// reports false when Close won.
func (p *port) poll(events int16) (bool, error) {
	fds := []unix.PollFd{
		{Fd: int32(p.fd), Events: events},
		{Fd: int32(p.wakeRead.Fd()), Events: unix.POLLIN},
	}
	for {
		_, err := unix.Poll(fds, -1)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return false, err
		}
		if fds[1].Revents != 0 {
			return false, nil
		}
		if fds[0].Revents != 0 {
			return true, nil
		}
	}
}

// closeDevice drops exclusive access before closing, so the tty can be opened
// again after this process exits or reopens the port.
func closeDevice(fd int) error {
	clearErr := unix.IoctlSetInt(fd, unix.TIOCNXCL, 0)
	return errors.Join(clearErr, unix.Close(fd))
}

func validateSettings(settings Settings) error {
	if settings.BaudRate <= 0 {
		return fmt.Errorf("%w: baud rate %d must be positive", ErrUnsupported, settings.BaudRate)
	}
	switch settings.DataBits {
	case 5, 6, 7, 8:
	default:
		return fmt.Errorf("%w: unknown data bits %d", ErrUnsupported, settings.DataBits)
	}
	switch settings.Parity {
	case ParityNone, ParityEven, ParityOdd:
	default:
		return fmt.Errorf("%w: unknown parity %d", ErrUnsupported, settings.Parity)
	}
	switch settings.StopBits {
	case 1, 2:
	default:
		return fmt.Errorf("%w: unknown stop bits %d", ErrUnsupported, settings.StopBits)
	}
	switch settings.FlowControl {
	case FlowNone, FlowRTSCTS, FlowXONXOFF:
	default:
		return fmt.Errorf("%w: unknown flow control %d", ErrUnsupported, settings.FlowControl)
	}
	return nil
}

func openError(action string, err error) error {
	switch {
	case errors.Is(err, unix.EBUSY):
		return fmt.Errorf("%w: %s: %v", ErrBusy, action, err)
	case errors.Is(err, unix.ENOENT), errors.Is(err, unix.ENODEV), errors.Is(err, unix.ENXIO):
		return fmt.Errorf("%w: %s: %v", os.ErrNotExist, action, err)
	default:
		return fmt.Errorf("%s: %w", action, err)
	}
}

func settingsError(action string, err error) error {
	switch {
	case errors.Is(err, unix.EINVAL), errors.Is(err, unix.ENOTSUP), errors.Is(err, unix.EOPNOTSUPP):
		return fmt.Errorf("%w: %s: %v", ErrUnsupported, action, err)
	case errors.Is(err, unix.EBUSY):
		return fmt.Errorf("%w: %s: %v", ErrBusy, action, err)
	case errors.Is(err, unix.ENOENT), errors.Is(err, unix.ENODEV), errors.Is(err, unix.ENXIO):
		return fmt.Errorf("%w: %s: %v", os.ErrNotExist, action, err)
	default:
		return fmt.Errorf("%s: %w", action, err)
	}
}
