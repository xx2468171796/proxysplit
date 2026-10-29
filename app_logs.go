package main

import (
	"os"
	"os/exec"
	"runtime"
)

// OpenLogDir opens the daily log folder (<config>/proxysplit/logs) in the system
// file manager. Returns "" on success, else a message for the user.
func (a *App) OpenLogDir() string {
	dir := a.svc.LogDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "日志文件夹打不开：" + err.Error()
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return "日志文件夹打不开：" + err.Error()
	}
	go func() { _ = cmd.Wait() }() // reap; explorer exits with 1 even on success
	return ""
}
