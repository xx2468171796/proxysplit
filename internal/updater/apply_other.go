//go:build !windows && !darwin

package updater

import "errors"

func ScheduleInstall(string, string) error {
	return errors.New("本平台不支持自动安装")
}
