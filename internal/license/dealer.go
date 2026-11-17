package license

// Contact is the support contact shown to aigw (AI relay site) customers: the
// owner's WeChat for main-site customers, the dealer's for dealer-site ones.
type Contact struct {
	Wechat string `json:"wechat"`
	Brand  string `json:"brand,omitempty"`
}

// SetDealer records this device's dealer-site slug ("" = none). It is sent
// with sign-in, register and POWER云 sync so the server can attribute the
// account (first value wins there) and return that dealer's contact.
func (c *Client) SetDealer(slug string) {
	c.mu.Lock()
	c.dealer = slug
	c.mu.Unlock()
}

// withDealerLocked adds the dealer slug to an auth payload. Caller holds c.mu.
func (c *Client) withDealerLocked(payload map[string]any) map[string]any {
	if c.dealer != "" {
		payload["dealer"] = c.dealer
	}
	return payload
}
