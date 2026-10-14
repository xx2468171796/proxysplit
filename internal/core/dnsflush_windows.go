package core

import "golang.org/x/sys/windows"

var procFlushDNS = windows.NewLazySystemDLL("dnsapi.dll").NewProc("DnsFlushResolverCache")

// flushSystemDNS empties the Windows DNS client cache (what `ipconfig
// /flushdns` does), so no app keeps a fake IP after the core is gone.
func flushSystemDNS() {
	if procFlushDNS.Find() == nil {
		_, _, _ = procFlushDNS.Call()
	}
}
