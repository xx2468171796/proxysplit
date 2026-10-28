package service

import (
	"encoding/json"
	"net/url"

	"proxysplit/internal/nodereport"
	"proxysplit/internal/nodes"
)

// NodeInventory is every node and subscription with full links, for the
// internal node report (internal/nodereport, docs/节点上报.md).
func (s *Service) NodeInventory() nodereport.Inventory {
	// Copy under the lock; links are built after it (review 2026-10-28).
	s.mu.Lock()
	inv := nodereport.Inventory{SelectedID: s.cfg.SelectedID}
	list := make([]nodes.Node, 0, len(s.cfg.Nodes))
	for _, n := range s.cfg.Nodes {
		if n != nil {
			list = append(list, *n)
		}
	}
	subs := append([]Sub(nil), s.cfg.Subs...)
	s.mu.Unlock()
	for i := range list {
		inv.Nodes = append(inv.Nodes, reportNode(&list[i]))
	}
	for _, sub := range subs {
		host := ""
		if u, err := url.Parse(sub.URL); err == nil {
			host = u.Hostname()
		}
		inv.Subs = append(inv.Subs, nodereport.Sub{ID: sub.ID, Name: sub.Name, URL: sub.URL, Host: host,
			NodeCount: sub.NodeCount, AutoUpdate: sub.AutoUpdate, LastUpdate: sub.LastUpdate})
	}
	return inv
}

func reportNode(n *nodes.Node) nodereport.Node {
	r := nodereport.Node{ID: n.ID, Name: n.Name, Type: n.Type, Server: n.Server, Port: n.Port,
		Network: n.Network, Security: n.Security, SNI: n.SNI, Core: n.EffectiveCore(), Via: n.Via,
		SubID: n.SubID, Official: n.Official, Latency: n.Latency, TCPLatency: n.TCPLatency, Speed: n.Speed}
	switch {
	case n.Official:
		r.Source = "official"
	case n.SubID != "":
		r.Source = "sub"
	default:
		r.Source = "manual"
	}
	switch {
	case n.Official: // signed POWER云 profile: nothing shareable
	case n.HasRaw():
		if r.Type == "" {
			r.Type = "raw"
		}
		b, _ := json.Marshal(n.Outbounds)
		r.Link = string(b)
	default:
		r.Link = nodes.ToLink(n)
	}
	return r
}
