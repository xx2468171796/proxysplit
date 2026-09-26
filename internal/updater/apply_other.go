//go:build !windows

package updater

import "errors"

func ScheduleInstall(string, string) error {
	return errors.New("自动安装目前仅支持 Windows")
}
