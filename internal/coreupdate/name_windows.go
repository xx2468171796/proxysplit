package coreupdate

// SingBoxExe is the core's file name in the bin dir.
const SingBoxExe = "sing-box.exe"

// XrayExe is the Xray sidecar file name in the bin dir.
const XrayExe = "xray.exe"

// exeMagic is the leading magic of a Windows PE executable ("MZ").
var exeMagic = []byte{0x4D, 0x5A}
