package main

import (
	"embed"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// coreFS bundles the Windows sing-box and its pinned release metadata.
//
//go:embed bin/sing-box.exe bin/core-release.json
var coreFS embed.FS

const (
	coreExeFile  = "bin/sing-box.exe"
	coreMetaFile = "bin/core-release.json"
)

// pickFilter is the file type the 从文件夹选择 dialog offers.
var pickFilter = runtime.FileFilter{DisplayName: "可执行文件 (*.exe)", Pattern: "*.exe"}

// xrayFS carries bin/xray-release.json and, in release builds,
// bin/xray.exe (scripts/fetch-core.ps1). Without the EXE the sidecar is
// downloaded on first need from the pin's public URLs.
//
//go:embed bin/xray*
var xrayFS embed.FS

const xrayDir = "bin/"
