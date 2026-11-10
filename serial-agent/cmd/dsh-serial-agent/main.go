// Command dsh-serial-agent serves serial ports to the DeepSeek Harness.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/1outres/my-dsh-plugins/serial-agent/internal/client"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/config"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/identity"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/manager"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/ports"
	"github.com/1outres/my-dsh-plugins/serial-agent/internal/serialport"
)

var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stderr)
		return 2
	}
	switch args[0] {
	case "run":
		return runDaemon(args[1:], stdout, stderr)
	case "pubkey":
		return runPubkey(args[1:], stdout, stderr)
	case "keygen":
		return runKeygen(args[1:], stdout, stderr)
	case "ports":
		return runPorts(args[1:], stdout, stderr)
	case "version", "--version", "-version":
		fmt.Fprintf(stdout, "dsh-serial-agent %s\n", version)
		return 0
	case "help", "-h", "--help":
		usage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "dsh-serial-agent: unknown command %q\n\n", args[0])
		usage(stderr)
		return 2
	}
}

func usage(w io.Writer) {
	fmt.Fprint(w, `dsh-serial-agent <command> [options]

Commands:
  run      Connect to the Harness gateway and serve local serial ports.
  pubkey   Print the public key, fingerprint, and config line.
  keygen   Create the identity file.
  ports    List local serial ports that match the allow list.
  version  Print the agent version.

Run 'dsh-serial-agent <command> -h' for the options of one command.
`)
}

func runDaemon(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	flags.SetOutput(stderr)
	configPath := flags.String("config", "", "path to the JSON config file")
	server := flags.String("server", "", "override the server URL")
	identityFile := flags.String("identity", "", "override the identity file")
	flags.Usage = func() {
		fmt.Fprintf(stderr, "Usage: dsh-serial-agent run --config <file> [--server <url>] [--identity <file>]\n\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() > 0 {
		fmt.Fprintf(stderr, "dsh-serial-agent run: unexpected argument %q\n", flags.Arg(0))
		return 2
	}
	if *configPath == "" {
		fmt.Fprintln(stderr, "dsh-serial-agent run: --config is required")
		return 2
	}

	cfg, err := config.Load(*configPath, config.Overrides{Server: *server, IdentityFile: *identityFile})
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	logger := slog.New(slog.NewTextHandler(stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))
	for _, warning := range cfg.Warnings() {
		logger.Warn(warning)
	}

	created, id, err := identity.Ensure(cfg.IdentityFile)
	if err != nil {
		logger.Error("identity failed", "error", err)
		return 1
	}
	if created {
		logger.Info("created agent identity", "path", cfg.IdentityFile)
	}
	name, err := agentNameFromHost()
	if err != nil {
		logger.Error("agent name failed", "error", err)
		return 1
	}
	line, err := configLine(name, id)
	if err != nil {
		logger.Error("config line failed", "error", err)
		return 1
	}
	logger.Info("agent identity",
		"name", name,
		"fingerprint", id.Fingerprint(),
		"publicKey", id.PublicKeyText(),
		"config", line)

	portManager, err := manager.New(manager.Options{
		Allow:         ports.New(cfg.Allow),
		Opener:        serialport.SystemOpener{},
		BufferBytes:   cfg.BufferBytes,
		OrphanTimeout: cfg.OrphanTimeout,
		Logger:        logger,
	})
	if err != nil {
		logger.Error("setup failed", "error", err)
		return 1
	}

	gateway, err := client.New(client.Options{
		Server:   cfg.Server,
		Identity: id,
		Manager:  portManager,
		Logger:   logger,
		Version:  version,
	})
	if err != nil {
		logger.Error("setup failed", "error", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := gateway.Run(ctx); err != nil {
		logger.Error("agent stopped", "error", err)
		portManager.CloseAll()
		return 1
	}
	portManager.CloseAll()
	logger.Info("agent stopped")
	return 0
}

func runPubkey(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("pubkey", flag.ContinueOnError)
	flags.SetOutput(stderr)
	identityFile := flags.String("identity", "", "path to the identity file")
	configPath := flags.String("config", "", "read identityFile from this config file")
	flags.Usage = func() {
		fmt.Fprintf(stderr, "Usage: dsh-serial-agent pubkey [--identity <file> | --config <file>]\n\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *identityFile != "" && *configPath != "" {
		fmt.Fprintln(stderr, "dsh-serial-agent pubkey: use --identity or --config, not both")
		return 2
	}

	path, err := identityPath(*identityFile, *configPath)
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	created, id, err := identity.Ensure(path)
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	if created {
		fmt.Fprintf(stderr, "created identity at %s\n", path)
	}
	name, err := agentNameFromHost()
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	line, err := configLine(name, id)
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "publicKey: %s\n", id.PublicKeyText())
	fmt.Fprintf(stdout, "fingerprint: %s\n", id.Fingerprint())
	fmt.Fprintf(stdout, "config: %s\n", line)
	return 0
}

func runKeygen(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("keygen", flag.ContinueOnError)
	flags.SetOutput(stderr)
	identityFile := flags.String("identity", "", "path to the identity file")
	flags.Usage = func() {
		fmt.Fprintf(stderr, "Usage: dsh-serial-agent keygen [--identity <file>]\n\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	path, err := identityPath(*identityFile, "")
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	if _, err := os.Stat(path); err == nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: identity %s already exists\n", path)
		return 1
	} else if !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(stderr, "dsh-serial-agent: stat identity %s: %v\n", path, err)
		return 1
	}
	id, err := identity.Generate(path)
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "identity: %s\n", path)
	fmt.Fprintf(stdout, "publicKey: %s\n", id.PublicKeyText())
	fmt.Fprintf(stdout, "fingerprint: %s\n", id.Fingerprint())
	return 0
}

func runPorts(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("ports", flag.ContinueOnError)
	flags.SetOutput(stderr)
	configPath := flags.String("config", "", "path to the JSON config file")
	flags.Usage = func() {
		fmt.Fprintf(stderr, "Usage: dsh-serial-agent ports --config <file>\n\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *configPath == "" {
		fmt.Fprintln(stderr, "dsh-serial-agent ports: --config is required")
		return 2
	}
	cfg, err := config.Load(*configPath, config.Overrides{})
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	devices, err := ports.New(cfg.Allow).List(nil)
	if err != nil {
		fmt.Fprintf(stderr, "dsh-serial-agent: %v\n", err)
		return 1
	}
	for _, device := range devices {
		line := device.Path
		if device.USB != nil {
			line += " usb=" + device.USB.VendorID + ":" + device.USB.ProductID
		}
		if device.Description != "" {
			line += " " + device.Description
		}
		fmt.Fprintln(stdout, line)
	}
	return 0
}

func identityPath(identityFile, configPath string) (string, error) {
	if identityFile != "" {
		return identityFile, nil
	}
	if configPath != "" {
		cfg, err := config.Load(configPath, config.Overrides{})
		if err != nil {
			return "", err
		}
		return cfg.IdentityFile, nil
	}
	return config.DefaultIdentityFile()
}

func agentNameFromHost() (string, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return "", fmt.Errorf("read hostname: %w", err)
	}
	return agentName(hostname)
}

func agentName(hostname string) (string, error) {
	short := hostname
	if index := strings.IndexByte(short, '.'); index >= 0 {
		short = short[:index]
	}
	short = strings.ToLower(short)

	var name strings.Builder
	lastDash := false
	for _, r := range short {
		isLetter := r >= 'a' && r <= 'z'
		isDigit := r >= '0' && r <= '9'
		switch {
		case isLetter || isDigit:
			name.WriteRune(r)
			lastDash = false
		case !lastDash && name.Len() > 0:
			name.WriteByte('-')
			lastDash = true
		}
	}

	result := strings.Trim(name.String(), "-")
	if len(result) > 32 {
		result = result[:32]
	}
	result = strings.TrimRight(result, "-")
	if result == "" {
		return "", fmt.Errorf("cannot derive an agent name from hostname %q", hostname)
	}
	return result, nil
}

type agentConfigLine struct {
	Name      string `json:"name"`
	PublicKey string `json:"publicKey"`
}

func configLine(name string, id *identity.Identity) (string, error) {
	data, err := json.Marshal(agentConfigLine{Name: name, PublicKey: id.PublicKeyText()})
	if err != nil {
		return "", fmt.Errorf("encode serialAgents entry: %w", err)
	}
	return string(data), nil
}
