package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"proxysplit/internal/nodes"
	"proxysplit/internal/powervpn"
	"proxysplit/internal/subs"
)

// PowerVPNSubName is the display name of the account-backed subscription.
const PowerVPNSubName = "POWER云"

// SetPowerVPN installs the POWER云 panel client (official nodes, device
// headers on subscriptions, pasted-link claim, core updates).
func (s *Service) SetPowerVPN(c *powervpn.Client) {
	s.mu.Lock()
	s.pv = c
	s.mu.Unlock()
}

func (s *Service) powervpnClient() *powervpn.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pv
}

func (s *Service) proxyViaLocked() string {
	if s.core != nil && s.core.Running() && s.core.Port() > 0 {
		return fmt.Sprintf("127.0.0.1:%d", s.core.Port())
	}
	return ""
}

// fetchSubscription resolves a subscription address to nodes. The pseudo
// address powervpn://profile is the logged-in POWER云 account's profile.
func (s *Service) fetchSubscription(url string) ([]*nodes.Node, error) {
	s.mu.Lock()
	via := s.proxyViaLocked()
	pv := s.pv
	s.mu.Unlock()
	if strings.EqualFold(strings.TrimSpace(url), powervpn.ProfileSubURL) {
		if pv == nil || !pv.LoggedIn() {
			return nil, fmt.Errorf("请先用 POWER云 账号登录")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		prof, err := pv.Profile(ctx)
		if err != nil {
			return nil, err
		}
		list, notices := prof.Nodes()
		for _, n := range notices {
			s.log("[POWER云] " + n)
		}
		if len(list) == 0 {
			if len(notices) > 0 {
				return nil, fmt.Errorf("%s", strings.Join(notices, "；"))
			}
			return nil, fmt.Errorf("POWER云 账号下暂无可用线路（请先在 POWER云 购买或开通线路）")
		}
		return list, nil
	}
	res, err := subs.FetchWith(url, via, pv)
	if err != nil {
		return nil, err
	}
	for _, n := range res.Notices {
		s.log("[POWER云] " + n)
	}
	return res.Nodes, nil
}

// EnsurePowerVPNSub adds (or refreshes) the "POWER云" subscription backed by
// /api/client/profile. It is refreshed on the normal subscription schedule.
func (s *Service) EnsurePowerVPNSub() error {
	id := subID(powervpn.ProfileSubURL)
	s.mu.Lock()
	exists := s.subscriptionExistsLocked(id)
	s.mu.Unlock()
	if exists {
		return s.UpdateSub(id)
	}
	list, err := s.fetchSubscription(powervpn.ProfileSubURL)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if !s.subscriptionExistsLocked(id) {
		s.cfg.Subs = append(s.cfg.Subs, Sub{ID: id, Name: PowerVPNSubName, URL: powervpn.ProfileSubURL, AutoUpdate: true})
	}
	s.replaceSubscriptionNodesLocked(id, list)
	if s.cfg.SelectedID == "" && len(s.cfg.Nodes) > 0 {
		s.cfg.SelectedID = s.cfg.Nodes[0].ID
	}
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

// RemovePowerVPNSub drops the account-backed subscription (on POWER云 logout).
func (s *Service) RemovePowerVPNSub() { s.RemoveSub(subID(powervpn.ProfileSubURL)) }

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// officializePasted replaces pasted links that point at POWER云 entry hosts
// with the official nodes of the matching account (device claim). Any failure
// keeps the original link in compat mode.
func (s *Service) officializePasted(parsed []*nodes.Node) []*nodes.Node {
	pv := s.powervpnClient()
	if pv == nil || len(parsed) == 0 {
		return parsed
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	eps, err := pv.Endpoints(ctx)
	if err != nil || eps.Len() == 0 {
		return parsed
	}
	out := make([]*nodes.Node, 0, len(parsed))
	claimed := map[string][]*nodes.Node{} // uuid -> official nodes (claim once per account)
	for _, n := range parsed {
		uuid := strings.TrimSpace(n.UUID)
		if !uuidPattern.MatchString(uuid) || !eps.Match(n.Server) {
			out = append(out, n)
			continue
		}
		if list, done := claimed[uuid]; done {
			if list == nil {
				out = append(out, n)
			}
			continue
		}
		prof, err := pv.Claim(ctx, uuid)
		if err != nil {
			s.log("[POWER云] 链接识别失败，按普通节点添加：" + err.Error())
			claimed[uuid] = nil
			out = append(out, n)
			continue
		}
		list, notices := prof.Nodes()
		for _, m := range notices {
			s.log("[POWER云] " + m)
		}
		if len(list) == 0 {
			claimed[uuid] = nil
			out = append(out, n)
			continue
		}
		claimed[uuid] = list
		out = append(out, list...)
	}
	return out
}
