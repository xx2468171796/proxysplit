package accel

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
)

func body(msgs int) []byte {
	var b strings.Builder
	b.WriteString(`{"model":"claude","system":"`)
	b.WriteString(strings.Repeat("system prompt ", 800))
	for i := 0; i < msgs; i++ {
		fmt.Fprintf(&b, `{"role":"user","content":"message %d %s"},`, i, strings.Repeat("x", i*37%500))
	}
	return []byte(b.String())
}

func TestDeltaRoundtripSmall(t *testing.T) {
	a, b := body(200), body(201)
	sa := sha256.Sum256(a)
	enc, err := Encode(a, &sa, b)
	if err != nil {
		t.Fatal(err)
	}
	if enc.Prefix < len(a)-64 {
		t.Fatalf("前缀应覆盖几乎整个基准：%d / %d", enc.Prefix, len(a))
	}
	if len(enc.Frame) > 600 {
		t.Fatalf("增量帧应很小，实际 %d", len(enc.Frame))
	}
	got, err := Decode(enc.Frame, func(s Sha) []byte {
		if s == sa {
			return a
		}
		return nil
	})
	if err != nil || !bytes.Equal(got, b) {
		t.Fatalf("还原不一致：%v", err)
	}
}

func TestDeltaMovedMarkerUsesDictAfterBreak(t *testing.T) {
	head := body(300)
	var tail strings.Builder
	for i := 0; i < 60; i++ {
		fmt.Fprintf(&tail, `{"role":"user","content":"tool result %d %s"},`, i, strings.Repeat("y", 900+i))
	}
	a := append(append(append([]byte{}, head...), `{"cache_control":{"type":"ephemeral"}}`...), tail.String()...)
	b := append(append(append(append([]byte{}, head...), `{}`...), tail.String()...), `{"role":"user","content":"new turn"}`...)
	sa := sha256.Sum256(a)
	enc, err := Encode(a, &sa, b)
	if err != nil {
		t.Fatal(err)
	}
	if len(b)-enc.Prefix < 50_000 {
		t.Fatal("断点应远离末尾")
	}
	if len(enc.Frame) > 2_000 {
		t.Fatalf("断点后的旧内容应按引用编码，实际 %d 字节", len(enc.Frame))
	}
	got, err := Decode(enc.Frame, func(Sha) []byte { return a })
	if err != nil || !bytes.Equal(got, b) {
		t.Fatalf("还原不一致：%v", err)
	}
}

func TestDeltaFullAndNeedBaseAndCorrupt(t *testing.T) {
	b := body(10)
	other := []byte("completely different")
	so := sha256.Sum256(other)
	enc, _ := Encode(other, &so, b)
	if enc.Frame[4] != 0 {
		t.Fatal("没有可用前缀时应发整包")
	}
	if got, err := Decode(enc.Frame, func(Sha) []byte { return nil }); err != nil || !bytes.Equal(got, b) {
		t.Fatal("整包还原失败")
	}
	a, c := body(50), body(51)
	sa := sha256.Sum256(a)
	enc, _ = Encode(a, &sa, c)
	if _, err := Decode(enc.Frame, func(Sha) []byte { return nil }); err != ErrNeedBase {
		t.Fatalf("缺基准应返回 ErrNeedBase，实际 %v", err)
	}
	forged := append([]byte{}, a...)
	forged[100] ^= 1
	if _, err := Decode(enc.Frame, func(Sha) []byte { return forged }); err == nil {
		t.Fatal("基准被改过必须拒绝，不能拼出错误内容")
	}
	for _, cut := range []int{0, 3, 5, 20, len(enc.Frame) - 1} {
		if _, err := Decode(enc.Frame[:cut], func(Sha) []byte { return a }); err == nil {
			t.Fatalf("截断到 %d 应报错", cut)
		}
	}
}

func TestStorePicksLongestPrefixAndEvicts(t *testing.T) {
	s := newStore(250, 100)
	put := func(b []byte) Sha { h := sha256.Sum256(b); s.insert(h, b); return h }
	put(bytes.Repeat([]byte{1}, 100))
	b2 := put(bytes.Repeat([]byte{2}, 100))
	put(bytes.Repeat([]byte{3}, 100)) // 超预算淘汰最久的
	if len(s.candidates()) != 2 {
		t.Fatalf("应只剩 2 条，实际 %d", len(s.candidates()))
	}
	e, p, ok := bestBase(s.candidates(), append(bytes.Repeat([]byte{2}, 100), 9), nil)
	if !ok || e.sha != b2 || p != 100 {
		t.Fatal("应挑前缀最长的")
	}
	if _, _, ok := bestBase(s.candidates(), []byte{2}, func(Sha) bool { return false }); ok {
		t.Fatal("不在中继已知集合里的不能选")
	}
}

func TestReadRequestAndRewrite(t *testing.T) {
	raw := "POST /v1/messages?beta=true HTTP/1.1\r\nHost: 127.0.0.1:18765\r\nUser-Agent: claude-cli/2.1\r\nAnthropic-Beta: a,b\r\nContent-Length: 5\r\n\r\nhello" +
		"POST /x HTTP/1.1\r\nhost: h\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n2;ext=1\r\nde\r\n0\r\n\r\n"
	r := bufio.NewReader(strings.NewReader(raw))
	a, err := readRequest(r)
	if err != nil || string(a.body) != "hello" || !a.keepAlive || a.method != "POST" {
		t.Fatalf("第一条：%v %+v", err, a)
	}
	want := "POST /v1/messages?beta=true HTTP/1.1\r\nHost: api.anthropic.com\r\nUser-Agent: claude-cli/2.1\r\nAnthropic-Beta: a,b\r\nContent-Length: 5\r\n\r\n"
	if got := string(rewriteHead(a.head, "api.anthropic.com")); got != want {
		t.Fatalf("改写后应只换 Host：\n%q\n%q", got, want)
	}
	b, err := readRequest(r)
	if err != nil || string(b.body) != "abcde" || !b.chunked || b.keepAlive {
		t.Fatalf("第二条：%v %+v", err, b)
	}
	if got := string(rewriteHead(b.head, "api.anthropic.com")); !strings.Contains(got, "host: api.anthropic.com\r\n") {
		t.Fatalf("小写 host 也要换：%q", got)
	}
}

func TestFramesAndRelayHead(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteString("HTTP/1.1 200 OK\r\nX-Accel-Stream: r1\r\nX-Accel-Owner: 8886\r\n\r\n")
	buf.WriteString("D\x02\x00\x00\x00hiK")
	sum := sha256.Sum256([]byte("hi"))
	buf.WriteString("E\x02\x00\x00\x00\x00\x00\x00\x00")
	buf.Write(sum[:])
	buf.WriteByte(0x80)
	buf.WriteString("HTTP/1.1 409 Conflict\r\nX-Accel-Error: need-base\r\nX-Accel-Not-Sent: 1\r\nContent-Length: 4\r\n\r\nneedNEXT")
	r := bufio.NewReader(&buf)
	h, err := readRelayHead(r)
	if err != nil || !h.stream || h.owner != 8886 {
		t.Fatalf("流头：%v %+v", err, h)
	}
	f, _ := readFrame(r)
	if f.kind != frameData || string(f.data) != "hi" {
		t.Fatal("数据帧")
	}
	if f, _ = readFrame(r); f.kind != frameKeep {
		t.Fatal("心跳帧")
	}
	f, _ = readFrame(r)
	if f.kind != frameEnd || f.total != 2 || f.sha != sum || !f.close || f.code != endOk {
		t.Fatalf("结束帧 %+v", f)
	}
	h, err = readRelayHead(r)
	if err != nil || h.stream || h.code != "need-base" || !h.notSent {
		t.Fatalf("错误头：%v %+v", err, h)
	}
	rest := make([]byte, 4)
	r.Read(rest)
	if string(rest) != "NEXT" {
		t.Fatal("错误体要读干净，连接还能复用")
	}
}

func TestPipeResponseChunkedByteExact(t *testing.T) {
	ev := "event: ping\ndata: {\"a\":1}\n\n"
	raw := fmt.Sprintf("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n%x\r\n%s\r\n0\r\n\r\nNEXT", len(ev), ev)
	var out bytes.Buffer
	up := bufio.NewReader(strings.NewReader(raw))
	keep, err := pipeResponse(up, &out, false)
	if err != nil || !keep || out.String() != raw[:len(raw)-4] {
		t.Fatalf("逐字节回流：%v %v %q", err, keep, out.String())
	}
}
