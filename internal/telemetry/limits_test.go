package telemetry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestLimitsMirrorContract reads the server contract and fails when a limit in
// limits.go no longer matches it.
func TestLimitsMirrorContract(t *testing.T) {
	read := func(rel string) string {
		raw, err := os.ReadFile(filepath.Join("..", "..", "server", filepath.FromSlash(rel)))
		if err != nil {
			t.Skipf("server contract not in this checkout: %v", err)
		}
		return strings.ReplaceAll(string(raw), "_", "")
	}
	contract := read("packages/contracts/src/telemetry.ts")
	routes := read("apps/api/src/telemetry-routes.ts")
	app := read("apps/api/src/app.ts")
	cases := []struct {
		name   string
		src    string
		re     string
		client int
	}{
		{"event.errorText", contract, `errorText: z\.string\(\)\.max\((\d+)\)`, limitErrorText},
		{"event.sessionId", contract, `sessionId: z\.string\(\)\.min\(1\)\.max\((\d+)\)`, limitSessionID},
		{"event.type", contract, `type: z\.string\(\)\.regex\(.*\)\.max\((\d+)\)`, limitEventType},
		{"event.durationMs", contract, `durationMs: z\.number\(\)\.int\(\)\.min\(0\)\.max\((\d+)\)`, limitDurationMs},
		{"logChunk.text", contract, `text: z\.string\(\)\.max\((\d+)\)`, limitChunkText},
		{"logChunk.lineCount", contract, `lineCount: z\.number\(\)\.int\(\)\.min\(0\)\.max\((\d+)\)`, limitChunkLines},
		{"batch.events", contract, `events: z\.array\(telemetryEventSchema\)\.max\((\d+)\)`, limitBatchEvents},
		{"batch.logs", contract, `logs: z\.array\(telemetryLogChunkSchema\)\.max\((\d+)\)`, limitBatchLogs},
		{"batch.appVersion", contract, `appVersion: z\.string\(\)\.max\((\d+)\)`, limitAppVersion},
		{"batch.coreVersion", contract, `coreVersion: z\.string\(\)\.max\((\d+)\)`, limitCoreVersion},
		{"batch.os", contract, `os: z\.string\(\)\.max\((\d+)\)`, limitOS},
		{"batch.arch", contract, `arch: z\.string\(\)\.max\((\d+)\)`, limitArch},
		{"batch.accountHint", contract, `accountHint: z\.string\(\)\.max\((\d+)\)`, limitAccountHint},
		{"gzip body", app, `TELEMETRYMAXGZIPBYTES\?\?(\d+)\*1024`, limitGzipBodyBytes / 1024},
		{"plain body", routes, `TELEMETRYMAXBODYBYTES = (\d+) \* 1024 \* 1024`, limitBodyBytes / 1024 / 1024},
	}
	for _, c := range cases {
		m := regexp.MustCompile(c.re).FindStringSubmatch(c.src)
		if m == nil {
			t.Errorf("%s: pattern not found in the server source (contract moved? update this test and limits.go)", c.name)
			continue
		}
		if server, _ := strconv.Atoi(m[1]); server != c.client {
			t.Errorf("%s: server allows %d, limits.go says %d", c.name, server, c.client)
		}
	}
	if !strings.Contains(contract, "seq: z.number().int().min(0).max(1e12)") || limitSeq != 1e12 {
		t.Error("event.seq limit drifted")
	}
	if maxLineLen > limitErrorText || chunkFlushBytes+maxLineLen*4 > limitChunkText || mergeBytes >= limitGzipBodyBytes {
		t.Error("derived client sizes exceed the contract")
	}
}

func TestTruncateCountsUTF16AndSuffix(t *testing.T) {
	for _, s := range []string{
		strings.Repeat("a", limitErrorText+500),
		strings.Repeat("节点连接超时", 2000),              // 3 bytes, 1 unit each
		strings.Repeat("😀", limitErrorText),         // 4 bytes, 2 units each
		strings.Repeat("a", limitErrorText-1) + "😀", // the pair would straddle the limit
	} {
		got := truncate(s, limitErrorText)
		if n := utf16Len(got); n > limitErrorText {
			t.Errorf("truncate left %d units, limit %d", n, limitErrorText)
		}
		if !strings.HasSuffix(got, truncatedSuffix) || !json.Valid([]byte(strconv.Quote(got))) || strings.ContainsRune(got, '�') {
			t.Errorf("truncate must end with the suffix on a rune boundary: …%q", got[len(got)-24:])
		}
	}
	exact := strings.Repeat("好", limitErrorText)
	if truncate(exact, limitErrorText) != exact || truncate("short", limitErrorText) != "short" {
		t.Error("text within the limit must not change")
	}
}

// Redaction can make a line longer ("pwd=a" → "pwd=[redacted]"), so the limit
// has to hold after it, suffix included.
func TestSanitizeStaysWithinErrorTextLimit(t *testing.T) {
	for name, in := range map[string]string{
		"plain ascii":         strings.Repeat("dial tcp 1.2.3.4:443: i/o timeout; ", 400),
		"grows when redacted": strings.Repeat("pwd=a ", 1200),
		"chinese":             strings.Repeat("内核启动失败：虚拟网卡创建失败 ", 600),
		"just over":           strings.Repeat("x ", limitErrorText/2) + "yz",
	} {
		got := Sanitize(in)
		if n := utf16Len(got); n > limitErrorText {
			t.Errorf("%s: %d units after Sanitize, server limit %d", name, n, limitErrorText)
		}
		if !strings.HasSuffix(got, truncatedSuffix) {
			t.Errorf("%s: a cut line must say so", name)
		}
	}
}

// contractViolations is the server's validation, restated from the limits
// block: the fake upload servers in these tests answer 400 when it finds
// anything, exactly like the real one.
func contractViolations(b Batch) []string {
	var bad []string
	over := func(field, s string, max int) {
		if utf16Len(s) > max {
			bad = append(bad, field+" too long")
		}
	}
	over("appVersion", b.AppVersion, limitAppVersion)
	over("coreVersion", b.CoreVersion, limitCoreVersion)
	over("os", b.OS, limitOS)
	over("arch", b.Arch, limitArch)
	over("accountHint", b.AccountHint, limitAccountHint)
	if len(b.Events) > limitBatchEvents {
		bad = append(bad, "too many events")
	}
	if len(b.Logs) > limitBatchLogs {
		bad = append(bad, "too many log chunks")
	}
	for _, e := range b.Events {
		over("errorText", e.ErrorText, limitErrorText)
		over("event.sessionId", e.SessionID, limitSessionID)
		if e.SessionID == "" || !reEventType.MatchString(e.Type) || utf16Len(e.Type) > limitEventType || !reEventID.MatchString(e.EventID) {
			bad = append(bad, "event shape")
		}
		if _, err := time.Parse(time.RFC3339Nano, e.TS); err != nil {
			bad = append(bad, "event.ts")
		}
		if e.DurationMs != nil && (*e.DurationMs < 0 || *e.DurationMs > limitDurationMs) {
			bad = append(bad, "durationMs")
		}
		if e.Seq < 0 || e.Seq > limitSeq {
			bad = append(bad, "seq")
		}
		if e.ErrorCode != "" && !reErrorCode.MatchString(e.ErrorCode) {
			bad = append(bad, "errorCode")
		}
	}
	for _, c := range b.Logs {
		over("log.text", c.Text, limitChunkText)
		over("log.sessionId", c.SessionID, limitSessionID)
		if c.LineCount > limitChunkLines || c.SessionID == "" {
			bad = append(bad, "log chunk shape")
		}
	}
	return bad
}

// A segment spooled by an older client carries fields cut at the old, larger
// sizes (4096 + suffix). It must still produce a batch the server accepts.
func TestBatchFromOldSpoolFitsContract(t *testing.T) {
	twoDays := int64(2 * 86_400_000)
	old := strings.Repeat("内核启动失败 create tun: Access is denied. ", 200)[:4096] + "…[truncated]"
	recs := []record{
		{K: "e", E: &Event{EventID: NewUUID(), SessionID: "sess", Seq: 1, TS: "2026-11-18T01:02:03.000000004Z", Type: ProxyStart, Status: Fail,
			DurationMs: &twoDays, ErrorCode: ErrCoreStart, ErrorText: old}},
		{K: "l", T: 1000, S: strings.Repeat("x", 4096) + "…[truncated]"},
	}
	meta := Meta{DeviceID: strings.Repeat("a", 64), AppVersion: strings.Repeat("1.2.3-", 20), CoreVersion: strings.Repeat("c", 300),
		OS: strings.Repeat("Windows 11 ", 40), Arch: strings.Repeat("amd64", 9), AccountHint: strings.Repeat("u", 200)}
	evs, chunks := segmentParts(meta, "seg-0000000000000000001-"+strings.Repeat("s", 90)+".jsonl", recs, false)
	b := newBatch(meta, evs, chunks)
	if bad := contractViolations(b); len(bad) > 0 {
		t.Fatalf("batch breaks the contract: %v", bad)
	}
	if len(b.Events) != 1 || len(b.Logs) != 1 || *b.Events[0].DurationMs != limitDurationMs || !strings.HasSuffix(b.Events[0].ErrorText, truncatedSuffix) {
		t.Fatalf("fields must be cut, not dropped: %+v", b.Events)
	}
}
