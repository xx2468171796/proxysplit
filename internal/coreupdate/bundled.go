package coreupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// EnsureBundled upgrades old payloads when the client itself is upgraded, while
// preserving a newer core installed through the independent core updater.
func EnsureBundled(dir string, exe []byte, version, expectedHash string) error {
	installMu.Lock()
	defer installMu.Unlock()
	hash := sha256.Sum256(exe)
	if hex.EncodeToString(hash[:]) != expectedHash {
		return fmt.Errorf("embedded core SHA256 mismatch")
	}
	dst := filepath.Join(dir, "sing-box.exe")
	current, err := os.ReadFile(dst)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if sha256.Sum256(current) == hash {
		return nil
	}
	installed := ""
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, dst, "version")
		hideVersionWindow(cmd)
		out, runErr := cmd.Output()
		if runErr == nil {
			fields := strings.Fields(strings.SplitN(string(out), "\n", 2)[0])
			if len(fields) == 3 && fields[0] == "sing-box" && fields[1] == "version" {
				installed = fields[2]
			}
		}
	}
	upgrade, err := needsBundledUpgrade(installed, version)
	if err != nil {
		return err
	}
	if !upgrade {
		return nil
	}
	return installBinary(dir, exe)
}

var coreVersionPattern = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$`)

func needsBundledUpgrade(installed, bundled string) (bool, error) {
	b := coreVersionPattern.FindStringSubmatch(bundled)
	if b == nil || b[4] != "" {
		return false, fmt.Errorf("invalid bundled stable core version %q", bundled)
	}
	a := coreVersionPattern.FindStringSubmatch(installed)
	if a == nil {
		return true, nil
	}
	for i := 1; i <= 3; i++ {
		x, err := strconv.ParseUint(a[i], 10, 32)
		if err != nil {
			return false, err
		}
		y, err := strconv.ParseUint(b[i], 10, 32)
		if err != nil {
			return false, err
		}
		if x != y {
			return x < y, nil
		}
	}
	return a[4] != "", nil
}
