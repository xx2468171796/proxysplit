package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// ScheduleInstall starts a detached helper which waits for this process to
// exit, swaps the running ProxySplit.app for the one in the downloaded zip and
// opens it. The new version must write healthFile within a minute; otherwise
// the helper puts the old app back and opens it.
func ScheduleInstall(downloaded, healthFile string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	i := strings.Index(exe, ".app/Contents/MacOS/")
	if i < 0 {
		return fmt.Errorf("不是从 ProxySplit.app 运行的，不能自动安装")
	}
	target := exe[:i+len(".app")]
	if filepath.Ext(downloaded) != ".zip" {
		return fmt.Errorf("更新包必须是 zip")
	}
	probe := filepath.Join(filepath.Dir(target), ".proxysplit-update-write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("%s 不可写，无法自动安装：%w", filepath.Dir(target), err)
	}
	_ = os.Remove(probe)
	script := downloaded + ".install.sh"
	if err := os.WriteFile(script, []byte(installScript), 0o700); err != nil {
		return err
	}
	cmd := exec.Command("/bin/sh", script, strconv.Itoa(os.Getpid()), downloaded, target, healthFile)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

const installScript = `#!/bin/sh
# ProxySplit 自动安装（macOS）：参数 父进程号 更新包 目标.app 健康标记
PID=$1; ZIP=$2; APP=$3; HEALTH=$4
OLD="$APP.old"; NEW=$(mktemp -d)
log() { echo "$(date '+%F %T') $*" >> "$ZIP.install.log"; }
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 45 ]; do sleep 1; i=$((i+1)); done
if ! /usr/bin/ditto -x -k "$ZIP" "$NEW"; then log "解压失败"; open "$APP"; exit 1; fi
SRC=$(find "$NEW" -maxdepth 1 -name '*.app' | head -1)
[ -n "$SRC" ] || { log "包里没有 .app"; open "$APP"; exit 1; }
/usr/bin/xattr -dr com.apple.quarantine "$SRC" 2>/dev/null
rm -rf "$OLD"
mv "$APP" "$OLD" && mv "$SRC" "$APP" || { log "替换失败"; [ -d "$APP" ] || mv "$OLD" "$APP"; open "$APP"; exit 1; }
rm -f "$HEALTH"
open -n "$APP" --args --updated
i=0; while [ $i -lt 60 ]; do [ -f "$HEALTH" ] && break; sleep 1; i=$((i+1)); done
if [ -f "$HEALTH" ]; then rm -rf "$OLD" "$NEW"; log "已更新"; exit 0; fi
log "新版 60 秒内没起来，换回旧版"
pkill -f "^$APP/Contents/MacOS/" 2>/dev/null
rm -rf "$APP"; mv "$OLD" "$APP"; rm -rf "$NEW"
open "$APP"
`
