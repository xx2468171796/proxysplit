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

// GetAutostart reports whether login autostart is currently enabled.
func (s *Service) GetAutostart() bool {
	return autostart.Enabled()
}
