//go:build !windows

package aiguard

const TaipeiTimezone = "Taipei Standard Time"

func TimezoneID() string          { return "" }
func UserLocale() string          { return "" }
func SetTimezone(string) error    { return errUnsupported }
func ResyncClock() error          { return errUnsupported }
func ProxyEnv() map[string]string { return nil }
