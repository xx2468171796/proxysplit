package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
)

// xrayFS carries bin/xray-release.json and, in release builds,
// bin/xray.exe (scripts/fetch-core.ps1). Without the EXE the sidecar is
// downloaded on first need from the pin's public URLs.
//
//go:embed bin/xray*
var xrayFS embed.FS

// setupXray installs the bundled Xray sidecar into bin and registers the lazy
// downloader. Failures only affect Xray-only nodes, never startup.
func setupXray(ctx context.Context, bin string) {
	raw, err := xrayFS.ReadFile("bin/xray-release.json")
	if err != nil {
		return
	}
	rel, err := coreupdate.ParseXrayRelease(raw)
	if err != nil {
		runtime.LogError(ctx, "xray release: "+err.Error())
		return
	}
	if exe, err := xrayFS.ReadFile("bin/" + coreupdate.XrayExe); err == nil {
		if err := coreupdate.EnsureBundledXray(bin, exe, rel); err != nil {
			runtime.LogError(ctx, "xray payload: "+err.Error())
		}
	}
	core.SetXrayFetcher(func() error { return coreupdate.FetchXray(bin, rel, "") })
}
