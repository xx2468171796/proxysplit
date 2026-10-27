//go:build windows

package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// OSInfo returns "Windows 11 Pro 24H2 (26100.1234)"-style text.
func OSInfo() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return "windows"
	}
	defer k.Close()
	name, _, _ := k.GetStringValue("ProductName")
	disp, _, _ := k.GetStringValue("DisplayVersion")
	build, _, _ := k.GetStringValue("CurrentBuild")
	ubr, _, _ := k.GetIntegerValue("UBR")
	return fmt.Sprintf("%s %s (%s.%d)", name, disp, build, ubr)
}

// IsAdmin reports whether the process runs elevated.
func IsAdmin() bool { return windows.GetCurrentProcessToken().IsElevated() }

// Locale returns the first preferred UI language (e.g. zh-CN).
func Locale() string {
	langs, err := windows.GetUserPreferredUILanguages(windows.MUI_LANGUAGE_NAME)
	if err != nil || len(langs) == 0 {
		return ""
	}
	return langs[0]
}

// DefenderDetections queries Defender detection history that mentions
// ProxySplit or sing-box (bounded to 8 s; read-only, changes nothing).
func DefenderDetections() map[string]any {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	script := `$ErrorActionPreference='SilentlyContinue';$s=Get-MpComputerStatus|Select-Object -First 1 AntivirusEnabled,RealTimeProtectionEnabled;` +
		`$d=@(Get-MpThreatDetection|Where-Object{($_.Resources -join ' ') -match '(?i)proxysplit|sing-box'}|Select-Object -First 20 ThreatID,InitialDetectionTime,ActionSuccess,Resources);` +
		`$t=@(Get-MpThreat|Where-Object{$d.ThreatID -contains $_.ThreatID}|Select-Object ThreatID,ThreatName);` +
		`@{status=$s;detections=$d;threats=$t}|ConvertTo-Json -Depth 4 -Compress`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	raw, err := cmd.Output()
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	var out struct {
		Status     map[string]any `json:"status"`
		Detections []struct {
			ThreatID  any      `json:"ThreatID"`
			When      string   `json:"InitialDetectionTime"`
			Success   bool     `json:"ActionSuccess"`
			Resources []string `json:"Resources"`
		} `json:"detections"`
		Threats []map[string]any `json:"threats"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return map[string]any{"error": "unparsable output"}
	}
	dets := make([]any, 0, len(out.Detections))
	for _, d := range out.Detections {
		files := make([]string, 0, len(d.Resources))
		for _, r := range d.Resources {
			files = append(files, filepath.Base(r)) // basename only: paths carry the user name
		}
		dets = append(dets, map[string]any{"threatId": fmt.Sprint(d.ThreatID), "when": d.When, "actionSuccess": d.Success, "files": files})
	}
	return map[string]any{"status": out.Status, "detections": dets, "threats": out.Threats, "count": len(dets)}
}
