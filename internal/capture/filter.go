package capture

import (
	"fmt"
	"sort"
	"strings"
)

// Filter design (lowest overhead WinDivert allows without a WFP connect-redirect
// driver; see docs/memory/routing.md):
//   - probe handle: only the FIRST packet of each outbound TCP connection (pure
//     SYN) plus DNS queries. One packet per connection for unmatched programs.
//   - data handle: only packets whose local port belongs to a captured flow.
//     The port list is compiled into the filter and the handle is replaced when
//     the set changes, so unmatched data packets are never diverted at all.
//   - reply handle: loopback packets from our relay listener only.

// MaxFilterPorts caps the port list compiled into the data filter. WinDivert
// filters are limited in size; past this many captured flows the data handle
// falls back to all outbound TCP/UDP with a userspace map check.
const MaxFilterPorts = 120

// ProbeFilter catches new outbound connections (pure SYN, v4 and v6) and DNS.
func ProbeFilter() string {
	return "outbound and !loopback and ((tcp and tcp.Syn and !tcp.Ack) or (udp and udp.DstPort == 53))"
}

// SocketFilter sniffs socket events that tell us which process owns a local
// port (no packets, one event per socket operation).
func SocketFilter() string {
	return "!loopback and (event == CONNECT or event == BIND or event == CLOSE)"
}

// ReplyFilter catches the relay listener's loopback replies.
func ReplyFilter(relayPort int) string {
	return fmt.Sprintf("loopback and ip and tcp and tcp.SrcPort == %d", relayPort)
}

// DataFilter diverts only the given captured local ports. Empty sets yield a
// filter that matches nothing; oversize sets fall back to a broad filter.
func DataFilter(tcpPorts, udpPorts []uint16) string {
	if len(tcpPorts)+len(udpPorts) > MaxFilterPorts {
		return "outbound and !loopback and ip and (tcp or (udp and udp.DstPort != 53))"
	}
	var parts []string
	if len(tcpPorts) > 0 {
		parts = append(parts, "(tcp and !tcp.Syn and ("+portList("tcp.SrcPort", tcpPorts)+"))")
	}
	if len(udpPorts) > 0 {
		parts = append(parts, "(udp and udp.DstPort != 53 and ("+portList("udp.SrcPort", udpPorts)+"))")
	}
	if len(parts) == 0 {
		return "false"
	}
	return "outbound and !loopback and ip and (" + strings.Join(parts, " or ") + ")"
}

func portList(field string, ports []uint16) string {
	s := append([]uint16(nil), ports...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	terms := make([]string, len(s))
	for i, p := range s {
		terms[i] = fmt.Sprintf("%s == %d", field, p)
	}
	return strings.Join(terms, " or ")
}
