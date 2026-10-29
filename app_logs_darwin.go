package main

import "os/exec"

func openFolderCmd(dir string) *exec.Cmd { return exec.Command("open", dir) }
