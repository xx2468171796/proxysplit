package aiguard

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// The lock is one local NRPT rule (Name Resolution Policy Table, the Windows
// DNS client's per-namespace resolver policy): every AI namespace resolves only
// through DNSServer, a loopback address the core listens on (core.AIGuard
// DNSListen). With the core up AI names resolve through the line, IPv4 only;
// with ProxySplit stopped, exited or killed the lookup is refused on the spot
// and AI names do not resolve at all. Loopback matters: a query to any other
// address leaves the machine when the tunnel is down, and DNS-hijacking routers
// (our office router, some ISPs) answer it — measured 2026-10-21 with the TUN
// peer 172.19.0.2. Chrome / Edge turn their own secure DNS off while NRPT rules
// exist, so browsers follow the lock too.
const (
	// DNSServer is the loopback address of the core's AI DNS listener (port 53).
	DNSServer = "127.0.0.53"
	// ruleComment marks our rule so install / remove never touch others'.
	ruleComment = "ProxySplit-AI"

	localPolicyKey = `SYSTEM\CurrentControlSet\Services\Dnscache\Parameters\DnsPolicyConfig`
	gpoPolicyKey   = `SOFTWARE\Policies\Microsoft\Windows NT\DNSClient\DnsPolicyConfig`
)

// nrptRule identifies one rule of ours: the comment marks it, namespaces are
// its content. Tests use their own comment and namespaces.
type nrptRule struct {
	comment    string
	namespaces []string
}

func lockRule() nrptRule { return nrptRule{comment: ruleComment, namespaces: Namespaces()} }

// Installed reports whether our NRPT rule exists with the current namespaces
// and server (an outdated list counts as not installed, so Install refreshes it).
func Installed() bool { return lockRule().installed() }

// Present reports whether any rule of ours exists (current or outdated).
func Present() bool { return lockRule().present() }

// Install (re)writes our NRPT rule and flushes the DNS cache, so names cached
// before the lock (resolved by the ISP) are not used afterwards.
func Install() error { return lockRule().install() }

// Remove deletes our NRPT rule (other rules untouched) and flushes the cache.
func Remove() error { return lockRule().remove() }

func (r nrptRule) installed() bool {
	want := slices.Clone(r.namespaces)
	slices.Sort(want)
	found := false
	r.each(func(k registry.Key) {
		names, _, err := k.GetStringsValue("Name")
		server, _, err2 := k.GetStringValue("GenericDNSServers")
		if err != nil || err2 != nil || strings.TrimSpace(server) != DNSServer {
			return
		}
		slices.Sort(names)
		if slices.Equal(names, want) {
			found = true
		}
	})
	return found
}

func (r nrptRule) present() bool {
	found := false
	r.each(func(registry.Key) { found = true })
	return found
}

// GroupPolicyActive: a domain Group Policy NRPT exists. Windows then ignores
// local rules, so the lock cannot work on this machine.
func GroupPolicyActive() bool {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, gpoPolicyKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return false
	}
	defer k.Close()
	subs, err := k.ReadSubKeyNames(-1)
	return err == nil && len(subs) > 0
}

func (r nrptRule) each(fn func(registry.Key)) {
	root, err := registry.OpenKey(registry.LOCAL_MACHINE, localPolicyKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return
	}
	defer root.Close()
	subs, err := root.ReadSubKeyNames(-1)
	if err != nil {
		return
	}
	for _, name := range subs {
		k, err := registry.OpenKey(root, name, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		if c, _, err := k.GetStringValue("Comment"); err == nil && c == r.comment {
			fn(k)
		}
		k.Close()
	}
}

func (r nrptRule) install() error {
	return r.runPS(`$ErrorActionPreference = 'Stop'
Get-DnsClientNrptRule | Where-Object { $_.Comment -eq $env:PS_AI_COMMENT } | ForEach-Object { Remove-DnsClientNrptRule -Name $_.Name -Force }
Add-DnsClientNrptRule -Namespace ($env:PS_AI_NS -split ',') -NameServers $env:PS_AI_DNS -Comment $env:PS_AI_COMMENT -DisplayName 'ProxySplit AI' | Out-Null
Clear-DnsClientCache`)
}

func (r nrptRule) remove() error {
	return r.runPS(`$ErrorActionPreference = 'Stop'
Get-DnsClientNrptRule | Where-Object { $_.Comment -eq $env:PS_AI_COMMENT } | ForEach-Object { Remove-DnsClientNrptRule -Name $_.Name -Force }
Clear-DnsClientCache`)
}

var flushProc = windows.NewLazySystemDLL("dnsapi.dll").NewProc("DnsFlushResolverCache")

// FlushCache empties the Windows DNS cache, so failures cached while the core
// was down do not linger after it starts.
func FlushCache() {
	if flushProc.Find() == nil {
		_, _, _ = flushProc.Call()
	}
}

// runPS runs a fixed script; values go in through the environment (no quoting).
func (r nrptRule) runPS(script string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = append(os.Environ(),
		"PS_AI_NS="+strings.Join(r.namespaces, ","),
		"PS_AI_DNS="+DNSServer,
		"PS_AI_COMMENT="+r.comment,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return fmt.Errorf("系统 DNS 策略（NRPT）写入失败：%v %s", err, msg)
	}
	return nil
}
