//go:build windows

package license

import (
	"fmt"
	"syscall"
	"unsafe"
)

type dataBlob struct {
	size uint32
	data *byte
}

var crypt32 = syscall.NewLazyDLL("crypt32.dll")
var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var cryptProtectData = crypt32.NewProc("CryptProtectData")
var cryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
var localFree = kernel32.NewProc("LocalFree")

const cryptProtectUIForbidden = 0x1

func blob(input []byte) dataBlob {
	if len(input) == 0 {
		return dataBlob{}
	}
	return dataBlob{size: uint32(len(input)), data: &input[0]}
}
func blobBytes(b dataBlob) []byte {
	if b.size == 0 || b.data == nil {
		return nil
	}
	return append([]byte(nil), unsafe.Slice(b.data, b.size)...)
}
func protect(input []byte) ([]byte, error) {
	in := blob(input)
	entropyBytes := []byte("ProxySplit-License-State-v1")
	entropy := blob(entropyBytes)
	var out dataBlob
	r, _, e := cryptProtectData.Call(uintptr(unsafe.Pointer(&in)), 0, uintptr(unsafe.Pointer(&entropy)), 0, 0, cryptProtectUIForbidden, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, fmt.Errorf("CryptProtectData: %w", e)
	}
	defer localFree.Call(uintptr(unsafe.Pointer(out.data)))
	return blobBytes(out), nil
}
func unprotect(input []byte) ([]byte, error) {
	in := blob(input)
	entropyBytes := []byte("ProxySplit-License-State-v1")
	entropy := blob(entropyBytes)
	var out dataBlob
	r, _, e := cryptUnprotectData.Call(uintptr(unsafe.Pointer(&in)), 0, uintptr(unsafe.Pointer(&entropy)), 0, 0, cryptProtectUIForbidden, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, fmt.Errorf("CryptUnprotectData: %w", e)
	}
	defer localFree.Call(uintptr(unsafe.Pointer(out.data)))
	return blobBytes(out), nil
}
