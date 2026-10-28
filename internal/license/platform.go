package license

import "runtime"

// platformName is the device platform sent to the server ("windows" | "macos").
func platformName() string {
	if runtime.GOOS == "darwin" {
		return "macos"
	}
	return "windows"
}
