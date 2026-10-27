package procjob

import (
	"os/exec"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

var procIsProcessInJob = windows.NewLazySystemDLL("kernel32.dll").NewProc("IsProcessInJob")

func TestAttachPutsChildInJob(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "ping -n 3 127.0.0.1 >NUL")
	if err := cmd.Start(); err != nil {
		t.Skip(err)
	}
	defer cmd.Process.Kill()
	Attach(cmd)
	p, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(cmd.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(p)
	var in int32
	r, _, e := procIsProcessInJob.Call(uintptr(p), uintptr(handle()), uintptr(unsafe.Pointer(&in)))
	if r == 0 || in == 0 {
		t.Fatalf("child not in job: in=%d err=%v", in, e)
	}
}
