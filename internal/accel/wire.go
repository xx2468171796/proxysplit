package accel

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// ---- HTTP/1.1：请求头逐字节保留，只换 Host（发到官方的字节与 Claude Code 直连时一样）----

const maxHead = 64 << 10

type request struct {
	head      []byte // 原始请求头（含结尾空行）
	method    string
	target    string
	body      []byte // 已去掉分块编码
	chunked   bool
	keepAlive bool
}

func readLine(r *bufio.Reader, out []byte) ([]byte, int, error) {
	start := len(out)
	for {
		frag, err := r.ReadSlice('\n')
		out = append(out, frag...)
		if len(out) > maxHead {
			return out, 0, errors.New("头过长")
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if err != nil {
			if err == io.EOF && len(out) > start {
				return out, 0, io.ErrUnexpectedEOF
			}
			return out, len(out) - start, err
		}
		return out, len(out) - start, nil
	}
}

// readHead 读到空行为止；第一个字节前连接正常关闭返回 (nil, io.EOF)
func readHead(r *bufio.Reader) ([]byte, error) {
	head := make([]byte, 0, 1024)
	for {
		before := len(head)
		var n int
		var err error
		head, n, err = readLine(r, head)
		if err != nil {
			if err == io.EOF && before == 0 {
				return nil, io.EOF
			}
			if err == io.EOF {
				return nil, io.ErrUnexpectedEOF
			}
			return nil, err
		}
		_ = n
		line := head[before:]
		if bytes.Equal(line, []byte("\r\n")) || bytes.Equal(line, []byte("\n")) {
			if before == 0 {
				head = head[:0] // 请求之间多余的空行
				continue
			}
			return head, nil
		}
	}
}

// headerValue 在原始头里按名字（不分大小写）找第一个值
func headerValue(head []byte, name string) (string, bool) {
	lines := strings.Split(string(head), "\n")
	for _, l := range lines[1:] {
		k, v, ok := strings.Cut(l, ":")
		if ok && strings.EqualFold(strings.TrimSpace(k), name) {
			return strings.TrimSpace(v), true
		}
	}
	return "", false
}

func hasToken(v, token string) bool {
	for _, t := range strings.Split(v, ",") {
		if strings.EqualFold(strings.TrimSpace(t), token) {
			return true
		}
	}
	return false
}

func readRequest(r *bufio.Reader) (*request, error) {
	head, err := readHead(r)
	if err != nil {
		return nil, err
	}
	first, _, _ := strings.Cut(string(head), "\n")
	parts := strings.SplitN(strings.TrimRight(first, "\r"), " ", 3)
	if len(parts) != 3 {
		return nil, errors.New("请求行不合法")
	}
	req := &request{head: head, method: parts[0], target: parts[1]}
	conn, _ := headerValue(head, "connection")
	if parts[2] == "HTTP/1.1" {
		req.keepAlive = !hasToken(conn, "close")
	} else {
		req.keepAlive = hasToken(conn, "keep-alive")
	}
	te, _ := headerValue(head, "transfer-encoding")
	req.chunked = hasToken(te, "chunked")
	if req.chunked {
		req.body, err = readChunked(r)
		return req, err
	}
	if cl, ok := headerValue(head, "content-length"); ok {
		n, err := strconv.Atoi(cl)
		if err != nil || n < 0 || n > maxBody {
			return nil, errors.New("Content-Length 不合法")
		}
		req.body = make([]byte, n)
		if _, err := io.ReadFull(r, req.body); err != nil {
			return nil, err
		}
	}
	return req, nil
}

func readChunked(r *bufio.Reader) ([]byte, error) {
	var body []byte
	for {
		line, _, err := readLine(r, nil)
		if err != nil {
			return nil, err
		}
		s := strings.TrimSpace(string(line))
		s, _, _ = strings.Cut(s, ";")
		size, err := strconv.ParseInt(strings.TrimSpace(s), 16, 64)
		if err != nil || size < 0 {
			return nil, errors.New("分块长度不合法")
		}
		if size == 0 {
			for {
				t, _, err := readLine(r, nil)
				if err != nil {
					return nil, err
				}
				if string(t) == "\r\n" || string(t) == "\n" {
					return body, nil
				}
			}
		}
		if len(body)+int(size) > maxBody {
			return nil, errors.New("分块请求体超过上限")
		}
		at := len(body)
		body = append(body, make([]byte, size)...)
		if _, err := io.ReadFull(r, body[at:]); err != nil {
			return nil, err
		}
		if _, err := r.Discard(2); err != nil {
			return nil, err
		}
	}
}

// rewriteHead 只把 Host 的值换成上游，其余逐字节不动
func rewriteHead(head []byte, host string) []byte {
	out := make([]byte, 0, len(head)+16)
	for i, line := range bytes.SplitAfter(head, []byte("\n")) {
		if i > 0 {
			if k, _, ok := bytes.Cut(line, []byte(":")); ok && strings.EqualFold(string(k), "host") {
				out = append(out, k...)
				out = append(out, ": "+host+"\r\n"...)
				continue
			}
		}
		out = append(out, line...)
	}
	return out
}

func writeRequest(w io.Writer, head, body []byte, chunked bool) error {
	var b bytes.Buffer
	b.Grow(len(head) + len(body) + 32)
	b.Write(head)
	if chunked {
		if len(body) > 0 {
			fmt.Fprintf(&b, "%x\r\n", len(body))
			b.Write(body)
			b.WriteString("\r\n")
		}
		b.WriteString("0\r\n\r\n")
	} else {
		b.Write(body)
	}
	_, err := w.Write(b.Bytes())
	return err
}

// ---- 中继协议：流帧 D/K/E、回应头 ----

type endCode uint8

const (
	endOk endCode = iota
	endNotSent
	endNoResponse
	endUpstreamBroken
	endCancelled
	endOverflow
)

const streamCap = 16 << 20

type frameKind int

const (
	frameData frameKind = iota
	frameKeep
	frameEnd
)

type frame struct {
	kind  frameKind
	data  []byte
	total uint64
	sha   Sha
	code  endCode
	close bool
}

func readFrame(r *bufio.Reader) (frame, error) {
	t, err := r.ReadByte()
	if err != nil {
		return frame{}, err
	}
	switch t {
	case 'D':
		var l [4]byte
		if _, err := io.ReadFull(r, l[:]); err != nil {
			return frame{}, err
		}
		n := binary.LittleEndian.Uint32(l[:])
		if n > streamCap {
			return frame{}, errors.New("数据帧过大")
		}
		d := make([]byte, n)
		if _, err := io.ReadFull(r, d); err != nil {
			return frame{}, err
		}
		return frame{kind: frameData, data: d}, nil
	case 'K':
		return frame{kind: frameKeep}, nil
	case 'E':
		var b [41]byte
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return frame{}, err
		}
		f := frame{kind: frameEnd, total: binary.LittleEndian.Uint64(b[:8]), code: endCode(b[40] & 0x7f), close: b[40]&0x80 != 0}
		copy(f.sha[:], b[8:40])
		return f, nil
	default:
		return frame{}, fmt.Errorf("未知帧类型 %d", t)
	}
}

// relayHead 是中继回应头的解读
type relayHead struct {
	stream  bool   // 流开始，后面是帧
	owner   uint16 // 持有缓冲的实例私有端口
	code    string // 中继错误代码
	notSent bool   // 中继保证官方没收到
	status  int
}

func readRelayHead(r *bufio.Reader) (relayHead, error) {
	head, err := readHead(r)
	if err != nil {
		if err == io.EOF {
			err = io.ErrUnexpectedEOF
		}
		return relayHead{}, err
	}
	first, _, _ := strings.Cut(string(head), "\n")
	h := relayHead{}
	if f := strings.Fields(first); len(f) >= 2 {
		h.status, _ = strconv.Atoi(f[1])
	}
	if v, ok := headerValue(head, "x-accel-owner"); ok {
		p, _ := strconv.Atoi(v)
		h.owner = uint16(p)
	}
	if _, ok := headerValue(head, "x-accel-stream"); ok {
		h.stream = true
		return h, nil
	}
	h.code, _ = headerValue(head, "x-accel-error")
	if h.code == "" {
		h.code = "unexpected"
	}
	ns, _ := headerValue(head, "x-accel-not-sent")
	h.notSent = ns == "1"
	if cl, ok := headerValue(head, "content-length"); ok {
		n, _ := strconv.Atoi(cl)
		if n > 0 && n <= 64<<10 {
			if _, err := r.Discard(n); err != nil {
				return h, err
			}
		}
	}
	return h, nil
}

// readSimpleResponse 读一个带 Content-Length 的小响应（打招呼 / 健康检查）
func readSimpleResponse(r *bufio.Reader) (int, []byte, error) {
	head, err := readHead(r)
	if err != nil {
		return 0, nil, err
	}
	first, _, _ := strings.Cut(string(head), "\n")
	status := 0
	if f := strings.Fields(first); len(f) >= 2 {
		status, _ = strconv.Atoi(f[1])
	}
	cl, _ := headerValue(head, "content-length")
	n, _ := strconv.Atoi(cl)
	if n < 0 || n > 64<<10 {
		return status, nil, errors.New("响应体过大")
	}
	body := make([]byte, n)
	_, err = io.ReadFull(r, body)
	return status, body, err
}

func sha256Sum(b []byte) Sha { return sha256.Sum256(b) }
