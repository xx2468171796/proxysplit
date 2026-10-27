//go:build windows

package noderesolve

import (
	"net/netip"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ipUnicastIf is IP_UNICAST_IF / IPV6_UNICAST_IF (both 31 on Windows).
const ipUnicastIf = 31

// adapter is the part of an IP_ADAPTER_ADDRESSES entry we use.
type adapter struct {
	index  uint32
	metric uint32
	dns    []netip.Addr
	ourTUN bool
	gw     bool
}

// adapters lists the up, non-loopback adapters.
func adapters() []adapter {
	size := uint32(16 << 10)
	var buf []byte
	for range 3 {
		buf = make([]byte, size)
		p := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
		err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, windows.GAA_FLAG_INCLUDE_GATEWAYS|windows.GAA_FLAG_SKIP_MULTICAST|windows.GAA_FLAG_SKIP_ANYCAST, 0, p, &size)
		if err == nil {
			return walk(p)
		}
		if err != windows.ERROR_BUFFER_OVERFLOW {
			return nil
		}
	}
	return nil
}

func walk(p *windows.IpAdapterAddresses) []adapter {
	var out []adapter
	for ; p != nil; p = p.Next {
		if p.OperStatus != windows.IfOperStatusUp || p.IfType == windows.IF_TYPE_SOFTWARE_LOOPBACK {
			continue
		}
		a := adapter{index: p.IfIndex, metric: p.Ipv4Metric, gw: p.FirstGatewayAddress != nil}
		for u := p.FirstUnicastAddress; u != nil; u = u.Next {
			if ip, ok := sockaddrAddr(u.Address); ok && (ourTUN4.Contains(ip) || ourTUN6.Contains(ip)) {
				a.ourTUN = true
			}
		}
		for d := p.FirstDnsServerAddress; d != nil; d = d.Next {
			if ip, ok := sockaddrAddr(d.Address); ok && usableSystemDNS(ip) {
				a.dns = append(a.dns, ip)
			}
		}
		out = append(out, a)
	}
	return out
}

func sockaddrAddr(sa windows.SocketAddress) (netip.Addr, bool) {
	if sa.Sockaddr == nil {
		return netip.Addr{}, false
	}
	switch sa.Sockaddr.Addr.Family {
	case windows.AF_INET:
		p := (*syscall.RawSockaddrInet4)(unsafe.Pointer(sa.Sockaddr))
		return netip.AddrFrom4(p.Addr), true
	case windows.AF_INET6:
		p := (*syscall.RawSockaddrInet6)(unsafe.Pointer(sa.Sockaddr))
		return netip.AddrFrom16(p.Addr).Unmap(), true
	}
	return netip.Addr{}, false
}

// systemDNS returns the DNS servers of the physical adapters (not our TUN).
func systemDNS() []netip.Addr {
	var out []netip.Addr
	for _, a := range adapters() {
		if !a.ourTUN {
			out = append(out, a.dns...)
		}
	}
	return out
}

// physicalIndex is the up adapter with a gateway and the lowest IPv4 metric,
// excluding our TUN (0 = unknown).
func physicalIndex() uint32 {
	var best adapter
	for _, a := range adapters() {
		if a.ourTUN || !a.gw {
			continue
		}
		if best.index == 0 || a.metric < best.metric {
			best = a
		}
	}
	return best.index
}

// bindControl pins sockets to the physical default adapter.
func bindControl() func(network, address string, c syscall.RawConn) error {
	idx := physicalIndex()
	if idx == 0 {
		return nil
	}
	return func(network, _ string, c syscall.RawConn) error {
		var serr error
		err := c.Control(func(fd uintptr) {
			h := windows.Handle(fd)
			if network == "tcp6" || network == "udp6" {
				serr = windows.SetsockoptInt(h, windows.IPPROTO_IPV6, ipUnicastIf, int(idx))
				return
			}
			// IPv4 wants the index in network byte order.
			be := idx>>24 | idx>>8&0xff00 | idx<<8&0xff0000 | idx<<24
			serr = windows.SetsockoptInt(h, windows.IPPROTO_IP, ipUnicastIf, int(int32(be)))
		})
		if err != nil {
			return err
		}
		return serr
	}
}
