package telemetry

import "strings"

// codeRule maps raw error fragments (lower-case) to a normalised code. The
// first matching rule wins, so specific causes come before generic ones.
type codeRule struct {
	code  string
	frags []string
}

var codeRules = []codeRule{
	{ErrPanic, []string{"panic:", "runtime error"}},
	{ErrBlockedAV, []string{"火绒", "360安全", "360 安全", "360tray", "安全软件", "被拦截", "blocked by security", "virus", "病毒", "quarantine", "隔离"}},
	{ErrTunCreate, []string{"wintun", "tun interface", "tun 启动", "configure tun", "start tun", "tun/wintun", "虚拟网卡"}},
	{ErrPortInUse, []string{"address already in use", "only one usage of each socket", "端口被占用", "bind:"}},
	{ErrPermission, []string{"permission denied", "access is denied", "拒绝访问", "requires elevation", "管理员", "operation not permitted"}},
	{ErrLicense, []string{"license", "会员", "授权", "登录", "lease", "device_mismatch", "设备数量"}},
	{ErrNoNode, []string{"no node", "未选择节点", "请先选择", "没有可用节点", "节点不存在"}},
	{ErrParse, []string{"parse", "解析", "unmarshal", "invalid character", "unsupported", "不支持", "无法识别", "格式"}},
	{ErrSubFetch, []string{"订阅", "subscription"}},
	{ErrUpdateVerify, []string{"signature", "sha256", "签名", "校验"}},
	{ErrDNS, []string{"no such host", "dns", "lookup "}},
	{ErrTLS, []string{"tls", "x509", "certificate", "handshake"}},
	{ErrNodeAuth, []string{"authentication failed", "auth failed", "unauthorized", "invalid user", "407", "403 forbidden"}},
	{ErrNodeTimeout, []string{"timeout", "timed out", "deadline exceeded", "超时"}},
	{ErrNodeUnreach, []string{"connection refused", "connection reset", "no route", "unreachable", "eof"}},
	{ErrConfig, []string{"config", "配置"}},
	{ErrNetwork, []string{"network", "dial", "网络"}},
}

// typeDefault is the fallback code per event family when nothing matched.
func typeDefault(typ string) string {
	switch {
	case strings.HasPrefix(typ, "proxy.start"), strings.HasPrefix(typ, "proxy.restart"), strings.HasPrefix(typ, "core."):
		return ErrCoreStart
	case strings.HasPrefix(typ, "tun."):
		return ErrTunCreate
	case strings.HasPrefix(typ, "sub."):
		return ErrSubFetch
	case strings.HasPrefix(typ, "app.update"), typ == CoreUpdate:
		return ErrUpdateDownload
	case strings.HasPrefix(typ, "node.latency"), typ == NodeTCP, typ == NodeSpeed:
		return ErrNodeUnreach
	case strings.HasPrefix(typ, "account."):
		return ErrLicense
	case typ == NodeAdd:
		return ErrParse
	}
	return ErrUnknown
}

// Classify maps a raw error text to a normalised error code for typ.
func Classify(typ, text string) string {
	lower := strings.ToLower(text)
	if lower == "" {
		return typeDefault(typ)
	}
	// Update failures: a verification problem is not a download problem.
	if strings.HasPrefix(typ, "app.update") || typ == CoreUpdate {
		for _, f := range []string{"signature", "sha256", "签名", "校验"} {
			if strings.Contains(lower, f) {
				return ErrUpdateVerify
			}
		}
		return ErrUpdateDownload
	}
	for _, r := range codeRules {
		for _, f := range r.frags {
			if strings.Contains(lower, f) {
				return r.code
			}
		}
	}
	return typeDefault(typ)
}
