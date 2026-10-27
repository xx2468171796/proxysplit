package telemetry

import "strings"

// logWatch turns well-known core log lines into events, so TUN creation and
// core exits are recorded without hooks inside internal/core.
type logWatch struct{}

// inspect returns (type, status, error text) for a significant line, or "".
func (logWatch) inspect(line string) (string, Status, string) {
	l := strings.ToLower(line)
	switch {
	case strings.Contains(line, "[core] sing-box TUN up"):
		return TunCreate, OK, ""
	case strings.Contains(line, "[core] TUN 启动失败"):
		return TunCreate, Fail, line
	case strings.Contains(line, "[core] sing-box exited"):
		return CoreExit, Info, ""
	case strings.Contains(l, "fatal[") || strings.Contains(l, " fatal ") || strings.HasPrefix(l, "panic:"):
		return CoreFatal, Fail, line
	}
	return "", "", ""
}
