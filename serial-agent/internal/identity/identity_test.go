package identity

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

const rfcSeed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"

func TestKnownAnswer(t *testing.T) {
	seed, err := hex.DecodeString(rfcSeed)
	if err != nil {
		t.Fatal(err)
	}
	id := &Identity{private: ed25519.NewKeyFromSeed(seed)}
	if got, want := id.PublicKeyText(), "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo="; got != want {
		t.Fatalf("PublicKeyText = %q, want %q", got, want)
	}
	if got, want := id.Fingerprint(), "SHA256:If4x36FUomFia/hUBG/SJxt77UtqvkWqWId+9H+XIbk"; got != want {
		t.Fatalf("Fingerprint = %q, want %q", got, want)
	}

	signature := id.SignNonce("abc")
	raw, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		t.Fatalf("signature is not base64: %v", err)
	}
	if !ed25519.Verify(id.PublicKey(), AuthMessage("abc"), raw) {
		t.Fatal("signature does not verify")
	}
	if ed25519.Verify(id.PublicKey(), AuthMessage("abd"), raw) {
		t.Fatal("signature verifies for the wrong nonce")
	}
}

func TestGenerateLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "identity")
	generated, err := Generate(path)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %04o, want 0600", info.Mode().Perm())
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.PublicKeyText() != generated.PublicKeyText() {
		t.Fatal("loaded key differs")
	}
}

func TestEnsureCreatesThenLoads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity")
	created, first, err := Ensure(path)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if !created {
		t.Fatal("expected the first Ensure to create the key")
	}
	created, second, err := Ensure(path)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if created {
		t.Fatal("expected the second Ensure to load the key")
	}
	if first.PublicKeyText() != second.PublicKeyText() {
		t.Fatal("keys differ")
	}
}

func TestLoadRejectsGroupOrOtherAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity")
	if _, err := Generate(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected a permission error")
	}
}

func TestGenerateRefusesOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity")
	if _, err := Generate(path); err != nil {
		t.Fatal(err)
	}
	if _, err := Generate(path); err == nil {
		t.Fatal("expected an error when the identity exists")
	}
}

func TestLoadRejectsInvalidPEM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity")
	if err := os.WriteFile(path, []byte("not a key"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected a parse error")
	}
}
