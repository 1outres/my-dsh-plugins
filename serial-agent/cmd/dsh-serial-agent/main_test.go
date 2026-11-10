package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentName(t *testing.T) {
	cases := []struct {
		hostname string
		expected string
	}{
		{"Lab-Mac.local", "lab-mac"},
		{"my_host.example.com", "my-host"},
		{"9router", "9router"},
		{"--edge--", "edge"},
		{strings.Repeat("a", 40), strings.Repeat("a", 32)},
	}
	for _, test := range cases {
		got, err := agentName(test.hostname)
		if err != nil {
			t.Fatalf("agentName(%q): %v", test.hostname, err)
		}
		if got != test.expected {
			t.Fatalf("agentName(%q) = %q, want %q", test.hostname, got, test.expected)
		}
	}
	if _, err := agentName("----"); err == nil {
		t.Fatal("expected an error for a hostname without letters or digits")
	}
}

func TestRunVersion(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"version"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit code = %d, stderr = %s", code, stderr.String())
	}
	if stdout.String() != "dsh-serial-agent dev\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestRunUnknownCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"nope"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(stderr.String(), "unknown command") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestPubkeyCreatesIdentityAndPrintsConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "identity")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"pubkey", "--identity", path}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit code = %d, stderr = %s", code, stderr.String())
	}
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if !strings.HasPrefix(lines[0], "publicKey: ") {
		t.Fatalf("line 1 = %q", lines[0])
	}
	if !strings.HasPrefix(lines[1], "fingerprint: SHA256:") {
		t.Fatalf("line 2 = %q", lines[1])
	}
	if !strings.HasPrefix(lines[2], `config: {"name":"`) || !strings.Contains(lines[2], `"publicKey":"`) {
		t.Fatalf("line 3 = %q", lines[2])
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("identity was not created: %v", err)
	}
}

func TestKeygenRefusesOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"keygen", "--identity", path}, &stdout, &stderr); code != 0 {
		t.Fatalf("keygen failed: %s", stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := run([]string{"keygen", "--identity", path}, &stdout, &stderr); code != 1 {
		t.Fatalf("second keygen exit code = %d", code)
	}
	if !strings.Contains(stderr.String(), "already exists") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestRunRequiresConfig(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"run"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(stderr.String(), "--config is required") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}
