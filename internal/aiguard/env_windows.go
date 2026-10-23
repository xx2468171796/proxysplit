package aiguard

import (
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// Machine facts for the AI environment check (internal/service/aienv.go).
// Settings that can be configured / restored (time zone, regional format,
// browser language, Claude Code, clock) live in pkg/aienv.

var proxyEnvNames = []string{"HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"}

// ProxyEnv returns proxy environment variables set for this user or machine
// (name → value). Programs started later (Claude Code, Codex, VS Code) inherit
// them and connect through that proxy instead of the tunnel deciding the exit.
func ProxyEnv() map[string]string {
	out := map[string]string{}
	read := func(root registry.Key, path string) {
		k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
		if err != nil {
			return
		}
		defer k.Close()
		for _, n := range proxyEnvNames {
			if v, _, err := k.GetStringValue(n); err == nil && strings.TrimSpace(v) != "" {
				out[strings.ToUpper(n)] = v
			}
		}
	}
	read(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`)
	read(registry.CURRENT_USER, `Environment`)
	for _, n := range proxyEnvNames {
		if v := strings.TrimSpace(os.Getenv(n)); v != "" {
			out[strings.ToUpper(n)] = v
		}
	}
	return out
}
