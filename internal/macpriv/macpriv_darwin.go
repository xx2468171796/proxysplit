// Package macpriv is ProxySplit's root access on macOS. sing-box needs root
// for TUN; without an Apple developer account there is no signed privileged
// helper, so ProxySplit installs once (one administrator password prompt) a
// root-owned control script plus a sudoers line that lets this user run that
// script — and nothing else — without a password. The script only runs this
// user's sing-box, stops it, and switches the system proxy.
package macpriv

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	// Ctl is the root-owned control script.
	Ctl         = "/usr/local/libexec/proxysplit-psctl"
	sudoersFile = "/etc/sudoers.d/proxysplit"
)

// Command runs the control script as root without a prompt (sudo -n).
func Command(args ...string) *exec.Cmd {
	return exec.Command("/usr/bin/sudo", append([]string{"-n", Ctl}, args...)...)
}

// Run runs the control script and returns its error with the output.
func Run(args ...string) error {
	out, err := Command(args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("psctl %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Installed reports whether the control script is set up for core and usable
// without a password.
func Installed(core string) bool {
	out, err := Command("ping").Output()
	return err == nil && strings.TrimSpace(string(out)) == "ok "+core
}

var userRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// Script is the install script (run as root) for user and the sing-box at core.
func Script(username, core string) (string, error) {
	if !userRe.MatchString(username) {
		return "", fmt.Errorf("用户名 %q 含特殊字符，装不了", username)
	}
	if strings.ContainsAny(core, "'\n") || !filepath.IsAbs(core) {
		return "", fmt.Errorf("内核路径不能含单引号: %s", core)
	}
	return fmt.Sprintf(`set -e
install -d -m 755 /usr/local/libexec
cat > %[1]s.tmp <<'PSCTL'
%[2]s
PSCTL
chown root:wheel %[1]s.tmp && chmod 755 %[1]s.tmp && mv -f %[1]s.tmp %[1]s
printf '%%s ALL=(root) NOPASSWD: %[1]s\n' '%[3]s' > %[4]s.tmp
chmod 440 %[4]s.tmp && visudo -cf %[4]s.tmp >/dev/null && mv -f %[4]s.tmp %[4]s
`, Ctl, ctlScript(core), username, sudoersFile), nil
}

// ctlScript is the control script. Arguments are validated here because the
// sudoers line allows any.
func ctlScript(core string) string {
	return `#!/bin/sh
# ProxySplit 特权控制脚本（root 所有；ProxySplit 装的，别手改）。
# 只做：用 root 跑本用户的 sing-box（TUN 要 root）、停掉它、开关系统代理。
PATH=/usr/bin:/bin:/usr/sbin:/sbin
CORE='` + core + `'
services() { networksetup -listallnetworkservices | tail -n +2 | grep -v '^\*'; }
case "$1" in
ping) echo "ok $CORE" ;;
run)
  case "$2" in /*.json) ;; *) echo "bad config" >&2; exit 2 ;; esac
  [ -f "$2" ] || exit 2
  exec "$CORE" run -c "$2" ;;
stop)
  pkill -TERM -f "^$CORE run -c" 2>/dev/null
  sleep 1
  pkill -KILL -f "^$CORE run -c" 2>/dev/null
  exit 0 ;;
proxy)
  if [ "$2" = on ]; then
    case "$3" in 127.0.0.1) ;; *) echo "bad host" >&2; exit 2 ;; esac
    case "$4" in ''|*[!0-9]*) echo "bad port" >&2; exit 2 ;; esac
    services | while IFS= read -r s; do
      networksetup -setwebproxy "$s" "$3" "$4"
      networksetup -setsecurewebproxy "$s" "$3" "$4"
      networksetup -setproxybypassdomains "$s" localhost 127.0.0.1 '*.local' 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10
    done
  else
    services | while IFS= read -r s; do
      networksetup -setwebproxystate "$s" off
      networksetup -setsecurewebproxystate "$s" off
    done
  fi ;;
*) echo "usage: psctl ping|run CONFIG|stop|proxy on HOST PORT|proxy off" >&2; exit 64 ;;
esac`
}

// Install asks for the administrator password once (system dialog) and sets
// up the control script for the current user and core.
func Install(core string) error {
	u, err := user.Current()
	if err != nil {
		return err
	}
	script, err := Script(u.Username, core)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "proxysplit-priv-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	f := filepath.Join(dir, "install.sh")
	if err := os.WriteFile(f, []byte(script), 0o600); err != nil {
		return err
	}
	prompt := "ProxySplit 需要管理员权限来接管应用流量（只需授权一次）。"
	as := fmt.Sprintf(`do shell script "/bin/sh %s" with prompt %q with administrator privileges`, f, prompt)
	out, err := exec.Command("/usr/bin/osascript", "-e", as).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "-128") {
			return errors.New("已取消授权：不授权就用不了「接管应用流量」")
		}
		return fmt.Errorf("授权失败: %v: %s", err, strings.TrimSpace(string(out)))
	}
	deadline := time.Now().Add(3 * time.Second)
	for !Installed(core) {
		if time.Now().After(deadline) {
			return errors.New("授权后仍无法使用特权控制脚本")
		}
		time.Sleep(200 * time.Millisecond)
	}
	return nil
}

// InstallAsRoot sets the control script up for username when already root
// (sudo proxysplit --install-helper <user>; used for unattended setup).
func InstallAsRoot(username, core string) error {
	if os.Geteuid() != 0 {
		return errors.New("要用 sudo 运行")
	}
	script, err := Script(username, core)
	if err != nil {
		return err
	}
	out, err := exec.Command("/bin/sh", "-c", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, out)
	}
	return nil
}
