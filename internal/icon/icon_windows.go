// Package icon extracts executable icons as data URIs for the UI. This is the
// Windows implementation: it pulls an HICON out of the exe, renders it into a
// 32bpp top-down DIB, and PNG-encodes the pixels — all via pure Win32 syscalls
// (no cgo).
package icon

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"unsafe"

	"golang.org/x/sys/windows"
)

// iconSize is the square edge (in pixels) we render every icon at.
const iconSize = 32

var (
	modshell32 = windows.NewLazySystemDLL("shell32.dll")
	modgdi32   = windows.NewLazySystemDLL("gdi32.dll")
	moduser32  = windows.NewLazySystemDLL("user32.dll")

	procExtractIconEx      = modshell32.NewProc("ExtractIconExW")
	procSHGetFileInfo      = modshell32.NewProc("SHGetFileInfoW")
	procCreateCompatibleDC = modgdi32.NewProc("CreateCompatibleDC")
	procCreateDIBSection   = modgdi32.NewProc("CreateDIBSection")
	procSelectObject       = modgdi32.NewProc("SelectObject")
	procDeleteObject       = modgdi32.NewProc("DeleteObject")
	procDeleteDC           = modgdi32.NewProc("DeleteDC")
	procDrawIconEx         = moduser32.NewProc("DrawIconEx")
	procDestroyIcon        = moduser32.NewProc("DestroyIcon")
)

const (
	biRGB        = 0      // BI_RGB (uncompressed)
	dibRGBColors = 0      // DIB_RGB_COLORS
	diNormal     = 0x0003 // DI_NORMAL = DI_IMAGE | DI_MASK

	shgfiIcon      = 0x000000100 // SHGFI_ICON
	shgfiLargeIcon = 0x000000000 // SHGFI_LARGEICON
)

// bitmapInfoHeader mirrors the Win32 BITMAPINFOHEADER structure.
type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// shFileInfo mirrors the Win32 SHFILEINFOW structure.
type shFileInfo struct {
	hIcon         windows.Handle
	iIcon         int32
	dwAttributes  uint32
	szDisplayName [260]uint16
	szTypeName    [80]uint16
}

// PNGBase64 returns the icon of the executable at exePath as a PNG data URI
// ("data:image/png;base64,..."). It is best-effort: on any failure (no icon,
// unreadable file, GDI error) it returns ("", nil) after releasing every
// handle it acquired.
func PNGBase64(exePath string) (string, error) {
	p, err := windows.UTF16PtrFromString(exePath)
	if err != nil {
		return "", nil
	}

	// Shell 图标优先：它会解析 EXE 的主图标、快捷方式和多尺寸资源，
	// 对 Chromium/Electron 等多图标程序比直接取第 0 个资源可靠。
	hicon := shellIcon(p)
	if hicon == 0 {
		hicon = extractIcon(p)
	}
	if hicon == 0 {
		return "", nil
	}
	defer procDestroyIcon.Call(uintptr(hicon))

	return renderIcon(hicon)
}

// extractIcon pulls the embedded icon out of the exe via ExtractIconExW. It
// asks for both the large and small icon, prefers the large one, and always
// destroys whichever handle it does not return. Returns 0 when the exe has no
// icon.
func extractIcon(p *uint16) windows.Handle {
	var large, small windows.Handle
	procExtractIconEx.Call(
		uintptr(unsafe.Pointer(p)),
		0, // nIconIndex
		uintptr(unsafe.Pointer(&large)),
		uintptr(unsafe.Pointer(&small)),
		1, // nIcons
	)
	switch {
	case large != 0:
		if small != 0 {
			procDestroyIcon.Call(uintptr(small))
		}
		return large
	case small != 0:
		return small
	default:
		return 0
	}
}

// shellIcon is the fallback path: ask the shell for the file's associated icon.
// The caller owns the returned HICON and must DestroyIcon it.
func shellIcon(p *uint16) windows.Handle {
	var info shFileInfo
	r, _, _ := procSHGetFileInfo.Call(
		uintptr(unsafe.Pointer(p)),
		0, // dwFileAttributes
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
		uintptr(shgfiIcon|shgfiLargeIcon),
	)
	if r == 0 || info.hIcon == 0 {
		return 0
	}
	return info.hIcon
}

// renderIcon draws hicon into a 32bpp top-down DIB and PNG-encodes the pixels.
// Every GDI resource it creates is freed before it returns.
func renderIcon(hicon windows.Handle) (string, error) {
	dc, _, _ := procCreateCompatibleDC.Call(0)
	if dc == 0 {
		return "", nil
	}
	defer procDeleteDC.Call(dc)

	bi := bitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		Width:       iconSize,
		Height:      -iconSize, // negative => top-down rows
		Planes:      1,
		BitCount:    32,
		Compression: biRGB,
	}

	var bits unsafe.Pointer
	hbmp, _, _ := procCreateDIBSection.Call(
		dc,
		uintptr(unsafe.Pointer(&bi)),
		dibRGBColors,
		uintptr(unsafe.Pointer(&bits)),
		0, // hSection
		0, // offset
	)
	if hbmp == 0 || bits == nil {
		return "", nil
	}
	defer procDeleteObject.Call(hbmp)

	old, _, _ := procSelectObject.Call(dc, hbmp)

	r, _, _ := procDrawIconEx.Call(
		dc,
		0, 0, // top-left
		uintptr(hicon),
		iconSize, iconSize,
		0, // istepIfAniCur
		0, // hbrFlickerFreeDraw
		diNormal,
	)

	// Deselect the DIB before it gets deleted by the deferred DeleteObject.
	if old != 0 {
		procSelectObject.Call(dc, old)
	}
	if r == 0 {
		return "", nil
	}

	// The DIB holds BGRA pixels (top-down); convert to RGBA.
	src := unsafe.Slice((*byte)(bits), iconSize*iconSize*4)
	img := image.NewNRGBA(image.Rect(0, 0, iconSize, iconSize))
	anyAlpha := false
	for i := 0; i < iconSize*iconSize; i++ {
		b := src[i*4+0]
		g := src[i*4+1]
		red := src[i*4+2]
		a := src[i*4+3]
		if a != 0 {
			anyAlpha = true
		}
		img.Pix[i*4+0] = red
		img.Pix[i*4+1] = g
		img.Pix[i*4+2] = b
		img.Pix[i*4+3] = a
	}
	// Some (older, mask-only) icons draw without writing per-pixel alpha,
	// leaving the channel fully zero — a transparent, invisible image. Treat
	// that case as opaque so the icon is actually visible.
	if !anyAlpha {
		for i := 0; i < iconSize*iconSize; i++ {
			img.Pix[i*4+3] = 0xff
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", nil
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
