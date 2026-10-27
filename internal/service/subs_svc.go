package service

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"proxysplit/internal/nodes"
)

// GetSubs returns configured subscriptions.
func (s *Service) GetSubs() []Sub {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Sub{}, s.cfg.Subs...) // non-nil → JSON [] (avoid phantom demo subs on empty)
}

// AddSub adds a subscription, fetches it and merges its nodes.
func (s *Service) AddSub(name, url string, autoUpdate bool) error {
	name, url = strings.TrimSpace(name), strings.TrimSpace(url)
	if name == "" || url == "" {
		return fmt.Errorf("订阅名称和地址不能为空")
	}
	list, err := s.fetchSubscription(url)
	if err != nil {
		return err
	}
	sub := Sub{ID: subID(url), Name: name, URL: url, AutoUpdate: autoUpdate}
	s.mu.Lock()
	for _, e := range s.cfg.Subs {
		if e.ID == sub.ID || strings.EqualFold(strings.TrimSpace(e.URL), url) {
			s.mu.Unlock()
			return fmt.Errorf("订阅地址已存在")
		}
	}
	s.cfg.Subs = append(s.cfg.Subs, sub)
	s.replaceSubscriptionNodesLocked(sub.ID, list)
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

// UpdateSub re-fetches a subscription and replaces its nodes.
func (s *Service) UpdateSub(id string) error {
	// Copy the primitive fields out under the lock; do NOT retain a pointer into
	// the Subs slice, which AddSub/RemoveSub may reallocate or compact in place.
	s.mu.Lock()
	url, found := "", false
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			url = s.cfg.Subs[i].URL
			found = true
		}
	}
	s.mu.Unlock()
	if !found {
		return fmt.Errorf("订阅不存在")
	}

	list, err := s.fetchSubscription(url)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if !s.subscriptionExistsLocked(id) {
		s.mu.Unlock()
		return fmt.Errorf("订阅不存在")
	}
	s.replaceSubscriptionNodesLocked(id, list)
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

// EditSub changes a subscription's display name/address and validates the new
// address before mutating any saved state. A failed fetch therefore leaves the
// old subscription and all of its nodes intact.
func (s *Service) EditSub(id, name, url string) error {
	name, url = strings.TrimSpace(name), strings.TrimSpace(url)
	if name == "" || url == "" {
		return fmt.Errorf("订阅名称和地址不能为空")
	}
	s.mu.Lock()
	found := false
	for _, sub := range s.cfg.Subs {
		if sub.ID == id {
			found = true
		} else if strings.EqualFold(strings.TrimSpace(sub.URL), url) {
			s.mu.Unlock()
			return fmt.Errorf("订阅地址已存在")
		}
	}
	s.mu.Unlock()
	if !found {
		return fmt.Errorf("订阅不存在")
	}

	list, err := s.fetchSubscription(url)
	if err != nil {
		return err
	}
	s.mu.Lock()
	index := -1
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			index = i
		} else if strings.EqualFold(strings.TrimSpace(s.cfg.Subs[i].URL), url) {
			s.mu.Unlock()
			return fmt.Errorf("订阅地址已存在")
		}
	}
	if index < 0 {
		s.mu.Unlock()
		return fmt.Errorf("订阅不存在")
	}
	s.cfg.Subs[index].Name = name
	s.cfg.Subs[index].URL = url
	s.replaceSubscriptionNodesLocked(id, list)
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

func (s *Service) subscriptionExistsLocked(id string) bool {
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			return true
		}
	}
	return false
}

// replaceSubscriptionNodesLocked atomically swaps a fetched subscription while
// preserving stable node identities and repairing every dependent selection.
// The caller must hold s.mu.
func (s *Service) replaceSubscriptionNodesLocked(id string, list []*nodes.Node) {
	var oldNodes []*nodes.Node
	for _, n := range s.cfg.Nodes {
		if n.SubID == id {
			oldNodes = append(oldNodes, n)
		}
	}
	reconcileSubscriptionNodes(oldNodes, list)
	keepNodeCores(oldNodes, list)
	kept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if n.SubID != id {
			kept = append(kept, n)
		}
	}
	s.cfg.Nodes = kept
	added := s.mergeNodesLocked(list, id)
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			s.cfg.Subs[i].NodeCount = added
			s.cfg.Subs[i].LastUpdate = time.Now().Format("2006-01-02 15:04")
			break
		}
	}
	s.healDanglingNodeRefsLocked()
}

// reconcileSubscriptionNodes preserves identity across provider format changes.
// Exact endpoint matches retain measurements. If the endpoint changed but the
// provider still exposes one uniquely named node of the same protocol, its ID
// is retained so per-app selections follow that logical node; measurements are
// intentionally reset because the actual endpoint changed.
//
// Official POWER云 nodes with a stable key (nodes.Node.OfficialKey) are matched
// by that key first: their tags carry the list position ("节点 2 · 台湾"), so
// endpoint / name matching would lose the node's identity whenever the panel
// reorders or adds nodes. Old nodes without a key (saved by an older build or
// from an older panel) are still matched by endpoint / name once, after which
// the key is saved along with the kept ID.
func reconcileSubscriptionNodes(oldNodes, freshNodes []*nodes.Node) {
	oldByEndpoint := make(map[string]*nodes.Node, len(oldNodes))
	oldByLogical := make(map[string]*nodes.Node, len(oldNodes))
	oldByKey := make(map[string]*nodes.Node, len(oldNodes))
	oldDuplicates := make(map[string]bool)
	freshCounts := make(map[string]int, len(freshNodes))
	for _, old := range oldNodes {
		if old.OfficialKey != "" {
			oldByKey[old.OfficialKey] = old
		}
	}
	// A keyed fresh node may only take over an old node with the same key, or
	// one without a key; never another node's.
	mayMatch := func(fresh, old *nodes.Node) bool {
		return old != nil && (old.OfficialKey == "" || old.OfficialKey == fresh.OfficialKey)
	}
	for _, old := range oldNodes {
		oldByEndpoint[nodeEndpointKey(old)] = old
		key := nodeLogicalKey(old)
		if _, exists := oldByLogical[key]; exists {
			oldDuplicates[key] = true
		} else {
			oldByLogical[key] = old
		}
	}
	for _, fresh := range freshNodes {
		freshCounts[nodeLogicalKey(fresh)]++
	}
	for _, fresh := range freshNodes {
		if fresh.OfficialKey != "" {
			if old := oldByKey[fresh.OfficialKey]; old != nil {
				fresh.ID = old.ID
				// Same node: measurements stay valid while it is the same server.
				if strings.EqualFold(old.Server, fresh.Server) && old.Port == fresh.Port && old.Type == fresh.Type {
					fresh.Latency, fresh.TCPLatency, fresh.Speed = old.Latency, old.TCPLatency, old.Speed
				}
				continue
			}
		}
		if old := oldByEndpoint[nodeEndpointKey(fresh)]; mayMatch(fresh, old) {
			fresh.ID = old.ID
			fresh.Latency = old.Latency
			fresh.TCPLatency = old.TCPLatency
			fresh.Speed = old.Speed
			continue
		}
		key := nodeLogicalKey(fresh)
		if !oldDuplicates[key] && freshCounts[key] == 1 {
			if old := oldByLogical[key]; mayMatch(fresh, old) {
				fresh.ID = old.ID
			}
		}
	}
}

func nodeLogicalKey(n *nodes.Node) string {
	if n == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(n.Type)) + "\x00" +
		strings.ToLower(strings.TrimSpace(n.Name))
}

func nodeEndpointKey(n *nodes.Node) string {
	if n == nil {
		return ""
	}
	sni := n.SNI
	if strings.EqualFold(n.Security, "none") {
		sni = ""
	}
	return strings.Join([]string{
		strings.ToLower(n.Type), n.Name, strings.ToLower(n.Server),
		strconv.Itoa(n.Port), n.UUID, n.Password, n.Username, n.Method,
		strconv.Itoa(n.AlterID), n.Cipher, strings.ToLower(n.Security), sni,
		n.Flow, n.PublicKey, n.ShortID, strings.ToLower(n.Network), n.Path, n.Host,
		n.Plugin, n.PluginOpts, n.RawKey(),
	}, "\x00")
}

// RemoveSub deletes a subscription and its nodes.
func (s *Service) RemoveSub(id string) {
	s.mu.Lock()
	subsKept := s.cfg.Subs[:0]
	for _, e := range s.cfg.Subs {
		if e.ID != id {
			subsKept = append(subsKept, e)
		}
	}
	s.cfg.Subs = subsKept
	nodesKept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if n.SubID != id {
			nodesKept = append(nodesKept, n)
		}
	}
	s.cfg.Nodes = nodesKept
	s.healDanglingNodeRefsLocked()
	s.save()
	s.mu.Unlock()
	s.applyLive()
}

// SetSubAutoUpdate toggles auto-update for a subscription.
func (s *Service) SetSubAutoUpdate(id string, on bool) {
	s.mu.Lock()
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			s.cfg.Subs[i].AutoUpdate = on
		}
	}
	s.save()
	s.mu.Unlock()
}

func subID(url string) string {
	sum := 0
	for _, c := range url {
		sum = sum*31 + int(c)
	}
	return fmt.Sprintf("sub%08x", uint32(sum))
}
