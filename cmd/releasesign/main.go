package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"flag"
	"fmt"
	"os"

	"proxysplit/internal/updater"
)

func main() {
	privatePath := flag.String("private-key", "", "Ed25519 PKCS#8 PEM private key")
	version := flag.String("version", "", "semantic version")
	hash := flag.String("sha256", "", "release SHA256")
	downloadURL := flag.String("url", "", "HTTPS download URL")
	flag.Parse()
	if *privatePath == "" || *version == "" || *hash == "" || *downloadURL == "" {
		fmt.Fprintln(os.Stderr, "private-key, version, sha256 and url are required")
		os.Exit(2)
	}
	raw, err := os.ReadFile(*privatePath)
	if err != nil {
		fatal(err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		fatal(fmt.Errorf("private key is not PEM"))
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		fatal(err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		fatal(fmt.Errorf("private key is not Ed25519"))
	}
	signature := ed25519.Sign(key, []byte(updater.SigningMessage(*version, *hash, *downloadURL)))
	fmt.Print(base64.StdEncoding.EncodeToString(signature))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
