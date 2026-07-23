package service

import (
	"encoding/base64"
	"fmt"

	qrcode "github.com/skip2/go-qrcode"

	"proxysplit/internal/nodes"
)

// GetNodeQR returns a PNG data URI containing a QR code that encodes the node's
// share link, so the node can be scanned into another client. It errors when the
// node is unknown or has no shareable link.
func (s *Service) GetNodeQR(id string) (string, error) {
	s.mu.Lock()
	n := s.nodeByID(id)
	var link string
	if n != nil {
		link = nodes.ToLink(n)
	}
	s.mu.Unlock()

	if n == nil {
		return "", fmt.Errorf("节点不存在")
	}
	if link == "" {
		return "", fmt.Errorf("该节点无法生成分享链接")
	}

	return EncodeQRDataURI(link, 320)
}

// EncodeQRDataURI creates a local PNG QR code without sending its payload to
// any third-party QR service. It is shared by node export and Alipay checkout.
func EncodeQRDataURI(value string, size int) (string, error) {
	if value == "" {
		return "", fmt.Errorf("二维码内容为空")
	}
	if size < 160 || size > 1024 {
		size = 320
	}
	png, err := qrcode.Encode(value, qrcode.Medium, size)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}
