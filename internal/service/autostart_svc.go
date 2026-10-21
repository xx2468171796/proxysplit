package service

import (
	"fmt"
	"os"

	"proxysplit/internal/autostart"
)

// SetAutostart enables or disables launching ProxySplit on user login.
func (s *Service) SetAutostart(on bool) error {
	if on {
		exe, err := os.Executable()
		if err != nil {
			return fmt.Errorf("get executable path: %w", err)
		}
		if err := autostart.Enable(exe); err != nil {
			return err
		}
		s.log("[autostart] 开机自启已开启")
		return nil
	}

	if err := autostart.Disable(); err != nil {
		return err
	}
	s.log("[autostart] 开机自启已关闭")
	return nil
}

// MigrateAutostart turns an older version's Run-key autostart (never started
// the elevated app) into the logon task. Runs once per launch, quietly.
func (s *Service) MigrateAutostart() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if done, err := autostart.MigrateLegacy(exe); err != nil {
		s.log("[autostart] 迁移开机自启失败：" + err.Error())
	} else if done {
		s.log("[autostart] 开机自启已改为计划任务（旧方式开机不会启动）")
	}
}

// GetAutostart reports whether login autostart is currently enabled.
func (s *Service) GetAutostart() bool {
	return autostart.Enabled()
}
