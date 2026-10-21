package main

import (
	"embed"
	"fmt"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// appVersion is injected by scripts/build.ps1 (for example "1.7.1").  Keeping
// it in the window title makes it immediately obvious which versioned exe is
// actually running when several builds are present in output\.
var appVersion = "dev"

// The commercial build pipeline injects these release-verification values.
// Development builds keep them empty and simply hide automatic updates.
var updateAPIURL string
var updatePublicKeyBase64 string
var updateTLSSPKISHA256 string

// Command-line flags:
//
//	--mcp         stdio MCP server for AI agents; starts the app on demand (mcpbridge.go)
//	--background  start in the tray without showing the window (used by --mcp)
//	--unlock-ai   remove the AI DNS lock and exit (support: the program was deleted
//	              while signed in, AI sites no longer resolve; aiguard_app.go)
const (
	mcpFlag        = "--mcp"
	backgroundFlag = "--background"
	unlockAIFlag   = "--unlock-ai"
)

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if strings.EqualFold(a, flag) {
			return true
		}
	}
	return false
}

func main() {
	if hasFlag(os.Args[1:], mcpFlag) {
		if err := runMCPBridge(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	if hasFlag(os.Args[1:], unlockAIFlag) {
		os.Exit(runUnlockAI())
	}

	// Create an instance of the app structure
	app := NewApp()
	app.background = hasFlag(os.Args[1:], backgroundFlag)

	// Create application with options
	err := wails.Run(&options.App{
		Title:       fmt.Sprintf("ProxySplit v%s — 应用分流代理", appVersion),
		Width:       1400,
		Height:      880,
		MinWidth:    1180,
		MinHeight:   720,
		StartHidden: app.background,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 17, G: 18, B: 23, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		// Single-instance: a 2nd launch just focuses the running window instead of
		// starting a rival instance (two instances = clobbered config / lost data +
		// competing sing-box TUN routes).
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "proxysplit-single-instance-lock",
			OnSecondInstanceLaunch: app.onSecondInstance,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
