package service

import (
	"encoding/base64"
	"errors"
	"fmt"

	qrcode "github.com/skip2/go-qrcode"

	"proxysplit/internal/nodes"
)

// errOfficialShare: POWER云 lines are paid credentials of the signed-in
// account — never handed out as links or QR codes.
var errOfficialShare = errors.New("POWER云 官方线路是会员专属，不能分享")

// NodeShare returns the node's share link (vless:// ss:// …) and a QR code of
// it (PNG data URI), so it can be pasted or scanned into another client.
func (s *Service) NodeShare(id string) (link, qr string, err error) {
	s.mu.Lock()
	n := s.nodeByID(id)
	if n != nil && !n.Official {
		link = nodes.ToLink(n)
	}
	s.mu.Unlock()
	switch {
	case n == nil:
		return "", "", fmt.Errorf("节点不存在")
	case n.Official:
		return "", "", errOfficialShare
	case link == "":
		return "", "", fmt.Errorf("该节点无法生成分享链接")
	}
	qr, err = EncodeQRDataURI(link, 320)
	return link, qr, err
}

// EncodeQRDataURI creates a local PNG QR code without sending its payload to
// any third-party QR service. It is shared by node sharing and Alipay checkout.
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
