package service

import (
	"encoding/base64"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

func TestEncodeQRDataURI(t *testing.T) {
	got, err := EncodeQRDataURI("https://example.invalid/alipay/order-123", 360)
	if err != nil {
		t.Fatal(err)
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(got, prefix) {
		t.Fatalf("unexpected data URI: %q", got[:min(len(got), 32)])
	}
	png, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(got, prefix))
	if err != nil {
		t.Fatal(err)
	}
	if len(png) < 8 || string(png[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatal("generated QR is not a PNG")
	}
}

// Own nodes share their link (+ QR); POWER云 lines never do.
func TestNodeShare(t *testing.T) {
	own, err := nodes.ParseLink("socks://dXNlcjpwYXNz@1.2.3.4:1080#mine")
	if err != nil {
		t.Fatal(err)
	}
	own.ID = "own"
	paid, _ := nodes.ParseLink("socks://dXNlcjpwYXNz@5.6.7.8:1080#paid")
	paid.ID, paid.Official = "paid", true
	s := guardService(t, own, paid)
	link, qr, err := s.NodeShare("own")
	if err != nil || !strings.HasPrefix(link, "socks://") || !strings.HasPrefix(qr, "data:image/png;base64,") {
		t.Fatalf("own node: %q %v", link, err)
	}
	if link, qr, err := s.NodeShare("paid"); err == nil || link != "" || qr != "" {
		t.Fatalf("POWER云 line shared: %q %v", link, err)
	}
	if _, _, err := s.NodeShare("nope"); err == nil {
		t.Fatal("unknown node")
	}
}
