//go:build !darwin

package core

import "os/exec"

// tunCommand is the TUN core process (the app itself runs elevated).
func (m *Manager) tunCommand(cfgPath string) (*exec.Cmd, error) {
	cmd := exec.Command(m.binPath, "run", "-c", cfgPath)
	hideWindow(cmd)
	return cmd, nil
}

// terminate kills a core process.
func terminate(cmd *exec.Cmd) { _ = cmd.Process.Kill() }
