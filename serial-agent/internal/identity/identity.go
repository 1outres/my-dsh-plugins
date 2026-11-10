// Package identity stores the Ed25519 key of one agent.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const authPrefix = "dsh-serial-agent auth v1\n"

// Identity is the private key of the agent.
type Identity struct {
	private ed25519.PrivateKey
}

// Generate writes a new key to path. It refuses to replace an existing file.
func Generate(path string) (*Identity, error) {
	if err := ensureParent(path); err != nil {
		return nil, err
	}
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return nil, fmt.Errorf("encode private key: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create identity %s: %w", path, err)
	}
	block := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if _, err := file.Write(block); err != nil {
		file.Close()
		return nil, fmt.Errorf("write identity %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("write identity %s: %w", path, err)
	}
	return &Identity{private: private}, nil
}

// Ensure loads the identity at path and creates it when the file is missing.
func Ensure(path string) (created bool, id *Identity, err error) {
	_, statErr := os.Stat(path)
	switch {
	case statErr == nil:
		id, err = Load(path)
		return false, id, err
	case errors.Is(statErr, os.ErrNotExist):
		id, err = Generate(path)
		return err == nil, id, err
	default:
		return false, nil, fmt.Errorf("stat identity %s: %w", path, statErr)
	}
}

// Load reads the private key at path.
func Load(path string) (*Identity, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat identity %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("identity %s is not a regular file", path)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("identity %s has mode %04o, which is readable by group or others; run chmod 600 %s",
			path, info.Mode().Perm(), path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read identity %s: %w", path, err)
	}
	block, _ := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, fmt.Errorf("identity %s is not a PEM PRIVATE KEY block", path)
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse identity %s: %w", path, err)
	}
	private, ok := key.(ed25519.PrivateKey)
	if !ok || len(private) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("identity %s does not hold an Ed25519 private key", path)
	}
	return &Identity{private: private}, nil
}

// PublicKeyText is the standard base64 of the 32 raw public key bytes.
func (i *Identity) PublicKeyText() string {
	return PublicKeyText(i.PublicKey())
}

// PublicKey returns the raw public key.
func (i *Identity) PublicKey() ed25519.PublicKey {
	return i.private.Public().(ed25519.PublicKey)
}

// Fingerprint is the OpenSSH style SHA256 fingerprint of the public key.
func (i *Identity) Fingerprint() string {
	return Fingerprint(i.PublicKey())
}

// SignNonce signs the handshake text for nonce and returns standard base64.
func (i *Identity) SignNonce(nonce string) string {
	signature := ed25519.Sign(i.private, AuthMessage(nonce))
	return base64.StdEncoding.EncodeToString(signature)
}

// AuthMessage is the exact text the handshake signature covers.
func AuthMessage(nonce string) []byte {
	return []byte(authPrefix + nonce)
}

// PublicKeyText encodes a raw Ed25519 public key.
func PublicKeyText(public ed25519.PublicKey) string {
	return base64.StdEncoding.EncodeToString(public)
}

// Fingerprint formats a raw Ed25519 public key as the agent reports it.
func Fingerprint(public ed25519.PublicKey) string {
	sum := sha256.Sum256(public)
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(sum[:])
}

func ensureParent(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create identity directory %s: %w", dir, err)
	}
	return nil
}
