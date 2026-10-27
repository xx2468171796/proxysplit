package core

import (
	"strings"

	"proxysplit/internal/capture"
)

// ProcessRoutes turns the app lists of opts into the capture engine's
// in-memory routes (same precedence as the TUN rules: 拦截 > per-target apps >
// 直连 > groups > default line). Hot app-list changes only swap this value.
func ProcessRoutes(opts Options) *capture.Routes {
	r := &capture.Routes{Block: map[string]bool{}, Apps: map[string]int{}, Direct: map[string]bool{}}
	if opts.Process == nil {
		return r
	}
	ports := opts.Process.Ports
	blocked := map[string]bool{}
	for _, n := range cleanList(opts.SplitBlock) {
		blocked[strings.ToLower(n)] = true
		addName(n, func(x string) { r.Block[x] = true }, func(d string) { r.BlockDirs = append(r.BlockDirs, d) })
	}
	scoped := scopedNames(opts)
	setApp := func(n string, port int) {
		addName(n, func(x string) {
			if _, ok := r.Apps[x]; !ok {
				r.Apps[x] = port
			}
		}, func(d string) { r.AppDirs = append(r.AppDirs, capture.DirRoute{Prefix: d, Port: port}) })
	}
	for n := range scoped {
		if !blocked[n] {
			setApp(n, ports[processScopedInbound(n)])
		}
	}
	direct := map[string]bool{}
	for _, n := range cleanList(opts.SplitDirect) {
		direct[strings.ToLower(n)] = true
		addName(n, func(x string) { r.Direct[x] = true }, func(d string) { r.DirectDirs = append(r.DirectDirs, d) })
	}
	for i, tag := range splitGroupTags(opts) {
		port := ports[processGroupInbound(tag)]
		for _, n := range cleanList(opts.SplitGroups[i].Names) {
			if k := strings.ToLower(n); !blocked[k] && !direct[k] && !scoped[k] {
				setApp(n, port)
			}
		}
	}
	if !opts.SplitWhitelist {
		r.Default = ports[processDefaultInbound]
	}
	r.Exclude = map[string]bool{}
	for _, p := range processPathDirect(opts) {
		r.Exclude[capture.NormExe(p)] = true
	}
	return r
}

// processPathDirect lists the exe paths the TUN rules send direct by
// process_path (端口代理 core, xray sidecar). The process config drops those
// rules (sing-box sees no process there), so the engine must exclude the same
// paths or 默认全走代理 would loop the cores' upstream traffic into themselves.
// Keep in sync with the process_path rules in buildTUNTree (guarded by a test).
func processPathDirect(opts Options) []string {
	var out []string
	for _, p := range []string{opts.PortProcessPath, opts.XrayPath} {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// addName files a list entry as an exe name or (DirPrefix) an install folder.
func addName(n string, exe func(string), dir func(string)) {
	if d, ok := strings.CutPrefix(n, DirPrefix); ok {
		if nd := capture.NormDir(d); nd != "" {
			dir(nd)
		}
		return
	}
	exe(strings.ToLower(n))
}
