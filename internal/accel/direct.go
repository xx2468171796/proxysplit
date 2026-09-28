package accel

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
)

// 兜底直连：中继不可用或明确没发出去时，编码端自己把请求原样发给官方（仍经所选节点）。
// 握手复刻 Claude Code（Bun / BoringSSL）的 ClientHello——与中继侧 accel/src/upstream.rs claude_code_connector 同一套参数，
// 官方看到的指纹不因兜底而变（目标 JA4 t13d1714h1_5b57614c22b0_7baf387fc6ff）。

func claudeHelloSpec() *utls.ClientHelloSpec {
	return &utls.ClientHelloSpec{
		TLSVersMin: utls.VersionTLS12,
		TLSVersMax: utls.VersionTLS13,
		CipherSuites: []uint16{
			utls.TLS_AES_128_GCM_SHA256, utls.TLS_AES_256_GCM_SHA384, utls.TLS_CHACHA20_POLY1305_SHA256,
			utls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, utls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			utls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384, utls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			utls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256, utls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
			utls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA, utls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA,
			utls.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA, utls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
			utls.TLS_RSA_WITH_AES_128_GCM_SHA256, utls.TLS_RSA_WITH_AES_256_GCM_SHA384,
			utls.TLS_RSA_WITH_AES_128_CBC_SHA, utls.TLS_RSA_WITH_AES_256_CBC_SHA,
		},
		CompressionMethods: []byte{0},
		// BoringSSL kExtensions 顺序（不打乱、无 GREASE 值），最后按 BoringSSL 规则补 padding（握手包 256–511 字节时才补，所以不同域名测出的扩展数可能差 1）
		Extensions: []utls.TLSExtension{
			&utls.SNIExtension{},
			&utls.GREASEEncryptedClientHelloExtension{}, // 65037：没有真 ECH 配置时 BoringSSL / Node 发 GREASE ECH
			&utls.ExtendedMasterSecretExtension{},
			&utls.RenegotiationInfoExtension{Renegotiation: utls.RenegotiateOnceAsClient},
			&utls.SupportedCurvesExtension{Curves: []utls.CurveID{utls.X25519, utls.CurveP256, utls.CurveP384}},
			&utls.SupportedPointsExtension{SupportedPoints: []byte{0}},
			&utls.SessionTicketExtension{},
			&utls.ALPNExtension{AlpnProtocols: []string{"http/1.1"}},
			&utls.StatusRequestExtension{},
			&utls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: []utls.SignatureScheme{
				utls.ECDSAWithP256AndSHA256, utls.PSSWithSHA256, utls.PKCS1WithSHA256,
				utls.ECDSAWithP384AndSHA384, utls.PSSWithSHA384, utls.PKCS1WithSHA384,
				utls.PSSWithSHA512, utls.PKCS1WithSHA512, utls.PKCS1WithSHA1,
			}},
			&utls.SCTExtension{},
			&utls.KeyShareExtension{KeyShares: []utls.KeyShare{{Group: utls.X25519}}},
			&utls.PSKKeyExchangeModesExtension{Modes: []uint8{utls.PskModeDHE}},
			&utls.SupportedVersionsExtension{Versions: []uint16{utls.VersionTLS13, utls.VersionTLS12}},
			&utls.UtlsPaddingExtension{GetPaddingLen: utls.BoringPaddingStyle},
		},
	}
}

func (e *Engine) dialOfficial() (net.Conn, error) {
	raw, err := e.dial(e.cfg.UpstreamHost, 443)
	if err != nil {
		return nil, err
	}
	tc := utls.UClient(raw, &utls.Config{ServerName: e.cfg.UpstreamHost, NextProtos: []string{"http/1.1"}}, utls.HelloCustom)
	if err := tc.ApplyPreset(claudeHelloSpec()); err != nil {
		raw.Close()
		return nil, err
	}
	_ = raw.SetDeadline(time.Now().Add(dialTimeout))
	if err := tc.Handshake(); err != nil {
		raw.Close()
		return nil, fmt.Errorf("TLS 握手：%w", err)
	}
	_ = raw.SetDeadline(time.Time{})
	return tc, nil
}

// direct 原样发官方并逐字节回流；返回客户端连接能否继续用
func (e *Engine) direct(client net.Conn, req *request, head []byte) bool {
	up, err := e.dialOfficial()
	if err != nil {
		e.stats.errors.Add(1)
		_ = writeLocal(client, "502 Bad Gateway", []byte("proxysplit-accel: "+err.Error()))
		return false
	}
	defer up.Close()
	if err := writeRequest(up, head, req.body, req.chunked); err != nil {
		e.stats.errors.Add(1)
		_ = writeLocal(client, "502 Bad Gateway", []byte("proxysplit-accel: upstream write failed"))
		return false
	}
	keep, err := pipeResponse(bufio.NewReaderSize(up, 64<<10), client, req.method == "HEAD")
	if err != nil {
		e.stats.errors.Add(1)
		return false
	}
	// 兜底连接不复用（兜底本来就少见，简单可靠优先）
	return keep && req.keepAlive
}

// pipeResponse 读一个响应并逐字节写给客户端（每块立即写，不攒批）
func pipeResponse(up *bufio.Reader, client io.Writer, headOnly bool) (bool, error) {
	for {
		head, err := readHead(up)
		if err != nil {
			return false, err
		}
		if _, err := client.Write(head); err != nil {
			return false, err
		}
		first, _, _ := strings.Cut(string(head), "\n")
		f := strings.Fields(first)
		if len(f) < 2 {
			return false, errors.New("响应头不合法")
		}
		status, _ := strconv.Atoi(f[1])
		if status >= 100 && status < 200 && status != 101 {
			continue
		}
		conn, _ := headerValue(head, "connection")
		keep := f[0] == "HTTP/1.1" && !hasToken(conn, "close") || f[0] != "HTTP/1.1" && hasToken(conn, "keep-alive")
		if headOnly || status == 204 || status == 304 {
			return keep, nil
		}
		te, _ := headerValue(head, "transfer-encoding")
		switch {
		case hasToken(te, "chunked"):
			for {
				line, _, err := readLine(up, nil)
				if err != nil {
					return false, err
				}
				if _, err := client.Write(line); err != nil {
					return false, err
				}
				s, _, _ := strings.Cut(strings.TrimSpace(string(line)), ";")
				size, err := strconv.ParseInt(strings.TrimSpace(s), 16, 64)
				if err != nil {
					return false, errors.New("分块长度不合法")
				}
				if size == 0 {
					for {
						t, _, err := readLine(up, nil)
						if err != nil {
							return false, err
						}
						if _, err := client.Write(t); err != nil {
							return false, err
						}
						if string(t) == "\r\n" || string(t) == "\n" {
							return keep, nil
						}
					}
				}
				if _, err := io.CopyN(client, up, size+2); err != nil {
					return false, err
				}
			}
		default:
			if cl, ok := headerValue(head, "content-length"); ok {
				n, err := strconv.ParseInt(cl, 10, 64)
				if err != nil || n < 0 {
					return false, errors.New("Content-Length 不合法")
				}
				_, err = io.CopyN(client, up, n)
				return keep && err == nil, err
			}
			_, err := io.Copy(client, up)
			return false, err
		}
	}
}
