package core

import (
	"os/exec"
	"syscall"
	"time"

	"proxysplit/internal/macpriv"
)

// tunCommand runs the TUN core as root through the control script; the first
// time it asks for the administrator password (macpriv.Install).
func (m *Manager) tunCommand(cfgPath string) (*exec.Cmd, error) {
	if !macpriv.Installed(m.binPath) {
		m.onLog("[core] 首次接管流量：请在系统弹窗里输入电脑密码（只要一次）")
		if err := macpriv.Install(m.binPath); err != nil {
			return nil, err
		}
	}
	return macpriv.Command("run", cfgPath), nil
}

// terminate stops a core process. The TUN core runs under sudo, which relays
// SIGTERM to sing-box but not SIGKILL (that would orphan a root sing-box), so
// those get SIGTERM and then the control script's stop.
func terminate(cmd *exec.Cmd) {
	if cmd.Path != "/usr/bin/sudo" {
		_ = cmd.Process.Kill()
		return
	}
	_ = cmd.Process.Signal(syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 30; i++ {
			if cmd.ProcessState != nil || syscall.Kill(cmd.Process.Pid, 0) != nil {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		close(done)
	}()
	<-done
	_ = macpriv.Run("stop")
}
