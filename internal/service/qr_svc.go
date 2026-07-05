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

	png, err := qrcode.Encode(link, qrcode.Medium, 320)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}
