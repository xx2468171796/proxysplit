// Package procjob ties our long-running child processes (sing-box, Xray) to
// the app's lifetime: they sit in one Windows Job Object with
// KILL_ON_JOB_CLOSE, so if ProxySplit crashes or is killed from Task Manager
// the kernel ends them too — no orphan core keeping ports, TUN or routes
// (v2rayN WindowsJobService does the same). Normal stops still go through
// each manager's own Stop.
package procjob

import (
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	once sync.Once
	job  windows.Handle
)

func handle() windows.Handle {
	once.Do(func() {
		h, err := windows.CreateJobObject(nil, nil)
		if err != nil {
			return
		}
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation,
			uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
			_ = windows.CloseHandle(h)
			return
		}
		job = h // never closed: the handle dies with our process, which is the point
	})
	return job
}

// Attach puts a started cmd's process into the job. Best effort: failures
// (no job, process already gone) leave the old behaviour.
func Attach(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	j := handle()
	if j == 0 {
		return
	}
	p, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(p)
	_ = windows.AssignProcessToJobObject(j, p)
}
