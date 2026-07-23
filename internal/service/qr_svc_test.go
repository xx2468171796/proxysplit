package service

import (
	"encoding/base64"
	"strings"
	"testing"
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
