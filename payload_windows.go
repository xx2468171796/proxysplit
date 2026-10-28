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
