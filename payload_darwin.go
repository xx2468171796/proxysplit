package main

import (
	"embed"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// coreFS bundles the macOS sing-box (scripts/fetch-core-darwin.sh) and its
// pinned release metadata.
//
//go:embed bin/darwin/sing-box bin/darwin/core-release.json
var coreFS embed.FS

const (
	coreExeFile  = "bin/darwin/sing-box"
	coreMetaFile = "bin/darwin/core-release.json"
)

// pickFilter is the file type the 从文件夹选择 dialog offers.
var pickFilter = runtime.FileFilter{DisplayName: "应用程序 (*.app)", Pattern: "*.app"}

// xrayFS carries bin/darwin/xray-release.json; the sidecar itself is
// downloaded on first need from the pin's public URLs (as on Windows).
//
//go:embed bin/darwin/xray*
var xrayFS embed.FS

const xrayDir = "bin/darwin/"
