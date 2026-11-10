//go:build darwin

package serialport

import "golang.org/x/sys/unix"

// IOSSIOSPEED is the macOS ioctl that sets a baud rate outside the termios
// speed table.
const ioctlIOSSIOSPEED = 0x80045402

// applySettings writes raw termios with a table speed, then asks the driver
// for a non-standard speed.
func applySettings(fd int, settings Settings) error {
	termios, err := unix.IoctlGetTermios(fd, unix.TIOCGETA)
	if err != nil {
		return settingsError("read settings", err)
	}
	configureTermios(termios, settings)
	speed, standard := darwinSpeed(settings.BaudRate)
	if standard {
		termios.Ispeed = speed
		termios.Ospeed = speed
	}
	if err := unix.IoctlSetTermios(fd, unix.TIOCSETA, termios); err != nil {
		return settingsError("apply settings", err)
	}
	if !standard {
		if err := unix.IoctlSetPointerInt(fd, ioctlIOSSIOSPEED, settings.BaudRate); err != nil {
			return settingsError("apply baud rate", err)
		}
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

// darwinSpeed returns the termios speed for a standard rate.
func darwinSpeed(baudRate int) (uint64, bool) {
	speeds := map[int]uint64{
		50:     unix.B50,
		75:     unix.B75,
		110:    unix.B110,
		134:    unix.B134,
		150:    unix.B150,
		200:    unix.B200,
		300:    unix.B300,
		600:    unix.B600,
		1200:   unix.B1200,
		1800:   unix.B1800,
		2400:   unix.B2400,
		4800:   unix.B4800,
		9600:   unix.B9600,
		19200:  unix.B19200,
		38400:  unix.B38400,
		57600:  unix.B57600,
		115200: unix.B115200,
		230400: unix.B230400,
	}
	speed, ok := speeds[baudRate]
	return speed, ok
}
