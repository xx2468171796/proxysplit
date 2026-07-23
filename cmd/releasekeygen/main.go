package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	privatePath := flag.String("private", "", "output PKCS#8 private-key PEM")
	publicPath := flag.String("public", "", "output public-key PEM")
	force := flag.Bool("force", false, "replace existing files")
	flag.Parse()
	if *privatePath == "" || *publicPath == "" {
		fmt.Fprintln(os.Stderr, "private and public output paths are required")
		os.Exit(2)
	}
	for _, path := range []string{*privatePath, *publicPath} {
		if _, err := os.Stat(path); err == nil && !*force {
			fmt.Fprintf(os.Stderr, "%s already exists (use --force to replace)\n", path)
			os.Exit(1)
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			fatal(err)
		}
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fatal(err)
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		fatal(err)
	}
	if err := os.WriteFile(*privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}), 0o600); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(*publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), 0o644); err != nil {
		fatal(err)
	}
	fmt.Println("release signing key pair generated")
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
