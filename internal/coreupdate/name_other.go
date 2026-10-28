//go:build !windows

package coreupdate

// SingBoxExe is the core's file name in the bin dir.
const SingBoxExe = "sing-box"

// XrayExe is the Xray sidecar file name in the bin dir.
const XrayExe = "xray"

// exeMagic is the leading magic of a 64-bit Mach-O executable (macOS).
var exeMagic = []byte{0xCF, 0xFA, 0xED, 0xFE}
