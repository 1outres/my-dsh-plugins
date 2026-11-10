//go:build linux

package serialport

import "golang.org/x/sys/unix"

// applySettings writes a raw termios2 with the requested speed, so any
// positive baud rate works through BOTHER.
func applySettings(fd int, settings Settings) error {
	termios, err := unix.IoctlGetTermios(fd, unix.TCGETS2)
	if err != nil {
		return settingsError("read settings", err)
	}
	configureTermios(termios, settings)
	termios.Cflag &^= unix.CBAUD
	termios.Cflag |= unix.BOTHER
	termios.Ispeed = uint32(settings.BaudRate)
	termios.Ospeed = uint32(settings.BaudRate)
	if err := unix.IoctlSetTermios(fd, unix.TCSETS2, termios); err != nil {
		return settingsError("apply settings", err)
	}
	return nil
}

func configureTermios(termios *unix.Termios, settings Settings) {
	setRawMode(termios)
	termios.Cflag |= unix.CLOCAL | unix.CREAD
	termios.Cflag &^= unix.CSIZE | unix.PARENB | unix.PARODD | unix.CSTOPB | unix.CRTSCTS
	termios.Iflag &^= unix.IXON | unix.IXOFF | unix.IXANY

	switch settings.DataBits {
	case 5:
		termios.Cflag |= unix.CS5
	case 6:
		termios.Cflag |= unix.CS6
	case 7:
		termios.Cflag |= unix.CS7
	case 8:
		termios.Cflag |= unix.CS8
	}

	switch settings.Parity {
	case ParityNone:
		termios.Iflag &^= unix.INPCK
	case ParityEven:
		termios.Cflag |= unix.PARENB
		termios.Iflag |= unix.INPCK
	case ParityOdd:
		termios.Cflag |= unix.PARENB | unix.PARODD
		termios.Iflag |= unix.INPCK
	}

	if settings.StopBits == 2 {
		termios.Cflag |= unix.CSTOPB
	}

	switch settings.FlowControl {
	case FlowRTSCTS:
		termios.Cflag |= unix.CRTSCTS
	case FlowXONXOFF:
		termios.Iflag |= unix.IXON | unix.IXOFF
	}

	termios.Cc[unix.VMIN] = 1
	termios.Cc[unix.VTIME] = 0
}

func setRawMode(termios *unix.Termios) {
	termios.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	termios.Oflag &^= unix.OPOST
	termios.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	termios.Cflag &^= unix.CSIZE | unix.PARENB
}
