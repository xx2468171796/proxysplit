// Command proclist dumps what proc.ListProcesses() sees, for debugging the
// app picker (e.g. missing chrome.exe / msedge.exe).
package main

import (
	"fmt"
	"strings"

	"proxysplit/internal/proc"
)

func main() {
	list, err := proc.ListProcesses()
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Printf("total unique exes: %d\n", len(list))
	fmt.Println("--- browser-ish ---")
	for _, p := range list {
		n := strings.ToLower(p.Name)
		if strings.Contains(n, "chrome") || strings.Contains(n, "edge") || strings.Contains(n, "msedge") ||
			strings.Contains(n, "firefox") || strings.Contains(n, "brave") {
			fmt.Printf("  %-28s desc=%q count=%-3d path=%q\n", p.Name, p.Desc, p.Count, p.Path)
		}
	}
	fmt.Println("--- first 40 (alphabetical) ---")
	for i, p := range list {
		if i >= 40 {
			break
		}
		fmt.Printf("  %-28s count=%d\n", p.Name, p.Count)
	}
}
