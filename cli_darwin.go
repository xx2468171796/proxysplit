package main

import (
	"fmt"
	"os"
	"path/filepath"

	"proxysplit/internal/coreupdate"
	"proxysplit/internal/macpriv"
)

// platformCLI handles macOS-only command lines:
//
//	sudo ProxySplit --install-helper <user>   set up the root control script
//	                                          for <user> without the dialog
func platformCLI(args []string) bool {
	if len(args) < 1 || args[0] != "--install-helper" {
		return false
	}
	if len(args) != 2 {
		fmt.Fprintln(os.Stderr, "用法: sudo ProxySplit --install-helper <用户名>")
		os.Exit(2)
	}
	home := filepath.Join("/Users", args[1])
	core := filepath.Join(home, "Library", "Application Support", "proxysplit", "bin", coreupdate.SingBoxExe)
	if err := macpriv.InstallAsRoot(args[1], core); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("已安装特权控制脚本:", macpriv.Ctl, "内核:", core)
	os.Exit(0)
	return true
}
