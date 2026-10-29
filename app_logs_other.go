//go:build !windows && !darwin

package main

import "os/exec"

func openFolderCmd(dir string) *exec.Cmd { return exec.Command("xdg-open", dir) }
