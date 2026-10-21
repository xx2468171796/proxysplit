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
// 握手按中继最近一次打招呼交来的稳定握手配置复刻（tlsprofile.go），与中继连官方的握手相同；没有可用配置就不兜底（Engine.fallback）。

func (e *Engine) dialOfficial(p *tlsProfile) (net.Conn, error) {
	spec, err := p.spec()
	if err != nil {
		return nil, err
	}
	raw, err := e.dial(e.cfg.UpstreamHost, 443)
	if err != nil {
		return nil, err
	}
	tc := utls.UClient(raw, &utls.Config{ServerName: e.cfg.UpstreamHost, NextProtos: []string{"http/1.1"}}, utls.HelloCustom)
	if err := tc.ApplyPreset(spec); err != nil {
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
func (e *Engine) direct(client net.Conn, req *request, head []byte, p *tlsProfile) bool {
	up, err := e.dialOfficial(p)
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
