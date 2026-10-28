//go:build !windows

package updater

// Platform is sent to /v1/releases/latest; PackageExt is the release file type
// (a zip of ProxySplit.app).
const (
	Platform   = "macos"
	PackageExt = ".zip"
)
