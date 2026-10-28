// Package macpriv is ProxySplit's root access on macOS. sing-box needs root
// for TUN; without an Apple developer account there is no signed privileged
// helper, so ProxySplit installs once (one administrator password prompt) a
// root-only directory with a control script, a copy of the core and a config
// checker, plus a sudoers line that lets this user run that script — and
// nothing else — without a password.
//
// Trust model: root only ever executes the root-owned core copy made at
// install time (a core update asks for the password again), and only with a
// config copied into the root directory and checked to have no file-writing
// options (log output, external UI, state / data dirs, services); the DNS
// cache path is forced into the root directory. Rule-set paths stay in the
// user's data dir and are only read.
package macpriv

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	// Dir is the root-only directory (parent /Library/PrivilegedHelperTools is
	// root-only too, so a user process cannot pre-create or swap it).
	Dir = "/Library/PrivilegedHelperTools/proxysplit"
	// Ctl is the root-owned control script.
	Ctl         = Dir + "/psctl"
	sudoersFile = "/etc/sudoers.d/proxysplit"
	legacyCtl   = "/usr/local/libexec/proxysplit-psctl" // test builds before 2026-10-29
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

// Available reports whether the control script answers (any core version);
// enough for stop and system proxy off.
func Available() bool {
	out, err := Command("ping").Output()
	return err == nil && strings.HasPrefix(string(out), "ok ")
}

// Installed reports whether the control script is usable without a password
// and its root core copy is the same file as core.
func Installed(core string) bool {
	sum, err := fileSHA(core)
	if err != nil {
		return false
	}
	out, err := Command("ping").Output()
	return err == nil && strings.TrimSpace(string(out)) == "ok "+sum
}

func fileSHA(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
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
umask 022
D=%[1]s
[ -d /Library/PrivilegedHelperTools ] || install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools
[ ! -L "$D" ] || { echo "$D is a symlink" >&2; exit 1; }
install -d -o root -g wheel -m 755 "$D"
chown root:wheel "$D" && chmod 755 "$D"
put() { t=$(mktemp "$D/.new.XXXXXX"); cat > "$t"; chown root:wheel "$t"; chmod "$2" "$t"; mv -f "$t" "$D/$1"; }
put psctl 755 <<'PSCTL'
%[2]s
PSCTL
put check.js 644 <<'CHECK'
%[3]s
CHECK
put sing-box 755 < '%[4]s'
t=$(mktemp /etc/sudoers.d/.proxysplit.XXXXXX)
printf '%%s ALL=(root) NOPASSWD: %%s\n' '%[5]s' "$D/psctl" > "$t"
chmod 440 "$t" && visudo -cf "$t" >/dev/null && mv -f "$t" %[6]s
[ -L %[7]s ] || rm -f %[7]s
`, Dir, ctlScript, checkJS, core, username, sudoersFile, legacyCtl), nil
}

// ctlScript is the control script. Arguments are validated here because the
// sudoers line allows any.
const ctlScript = `#!/bin/sh
# ProxySplit 特权控制脚本（root 所有；ProxySplit 装的，别手改）。
# 只做：用 root 跑授权时复制进来的 sing-box（TUN 要 root）、停掉它、开关系统代理。
PATH=/usr/bin:/bin:/usr/sbin:/sbin
D=` + Dir + `
services() { networksetup -listallnetworkservices | tail -n +2 | grep -v '^\*'; }
case "$1" in
ping) echo "ok $(shasum -a 256 "$D/sing-box" | cut -d' ' -f1)" ;;
run)
  case "$2" in /*.json) ;; *) echo "bad config" >&2; exit 2 ;; esac
  [ -f "$2" ] && [ ! -L "$2" ] || { echo "bad config" >&2; exit 2; }
  [ "$(stat -f %u "$2")" = "$SUDO_UID" ] || { echo "config not owned by caller" >&2; exit 2; }
  umask 077
  cat "$2" > "$D/run.json"
  osascript -l JavaScript "$D/check.js" "$D/run.json" "$D/cache.db" >/dev/null || { echo "config rejected" >&2; exit 2; }
  echo $$ > "$D/core.pid"
  exec "$D/sing-box" run -c "$D/run.json" ;;
stop)
  P=$(cat "$D/core.pid" 2>/dev/null)
  case "$P" in ''|*[!0-9]*) exit 0 ;; esac
  case "$(ps -p "$P" -o command= 2>/dev/null)" in
  "$D/sing-box run"*)
    kill -TERM "$P" 2>/dev/null
    i=0; while kill -0 "$P" 2>/dev/null && [ $i -lt 10 ]; do sleep 0.2; i=$((i+1)); done
    kill -KILL "$P" 2>/dev/null ;;
  esac
  rm -f "$D/core.pid"
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

// checkJS (JavaScript for Automation, always present on macOS) rejects config
// options that make sing-box write files and forces the DNS cache into Dir.
const checkJS = `ObjC.import('Foundation');
var BAD = {output: 1, external_ui: 1, external_ui_download_url: 1, data_directory: 1, state_directory: 1, cache_path: 1, config_path: 1, acme: 1, services: 1};
function walk(v, at) {
  if (v === null || typeof v !== 'object') return;
  for (var k in v) {
    if (BAD[k]) throw new Error('forbidden option ' + at + k);
    walk(v[k], at + k + '.');
  }
}
function run(argv) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  if (s.isNil()) throw new Error('read ' + argv[0]);
  var c = JSON.parse(ObjC.unwrap(s));
  walk(c, '');
  if (c.experimental && c.experimental.cache_file) c.experimental.cache_file.path = argv[1];
  if (!$(JSON.stringify(c)).writeToFileAtomicallyEncodingError(argv[0], true, $.NSUTF8StringEncoding, null)) throw new Error('write');
  return 'ok';
}`

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
	prompt := "ProxySplit 需要管理员权限来接管应用流量（只需授权一次，更新内核后再授权一次）。"
	as := fmt.Sprintf(`do shell script "/bin/sh " & quoted form of %q with prompt %q with administrator privileges`, f, prompt)
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
			return errors.New("授权后仍无法使用特权控制脚本（内核在安装时被改动？）")
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
