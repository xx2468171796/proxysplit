package main

import "testing"

func TestPaymentQRLinks(t *testing.T) {
	ok := []string{"https://qr.alipay.com/x", "alipays://platformapi/startapp?x=1", "weixin://wxpay/bizpayurl?pr=abc", "weixin://wxpay/bizpayurl"}
	for _, u := range ok {
		if !validPaymentURL(u) && !wechatNativePayURL(u) {
			t.Errorf("QR should accept %q", u)
		}
	}
	bad := []string{"weixin://wxpay/bizpayurl/extra", "weixin://dl/business?x", "weixin://wxpay/bizpayurl?x#y", "http://pay.example/x", "javascript:alert(1)"}
	for _, u := range bad {
		if validPaymentURL(u) || wechatNativePayURL(u) {
			t.Errorf("QR should reject %q", u)
		}
	}
	// The browser-open boundary still only takes https / alipays.
	if validPaymentURL("weixin://wxpay/bizpayurl?pr=abc") {
		t.Error("weixin links must not be opened locally")
	}
}
