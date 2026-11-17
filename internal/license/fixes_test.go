package license

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsDeviceLimitMatchesOnlyTheCode(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{&APIError{Status: http.StatusConflict, Code: "DEVICE_LIMIT"}, true},
		{&APIError{Status: http.StatusConflict, Code: ""}, false},
		{&APIError{Status: http.StatusConflict, Code: "SYNC_CONFLICT"}, false},
		{errors.New("DEVICE_LIMIT"), false},
	}
	for _, c := range cases {
		if got := isDeviceLimit(c.err); got != c.want {
			t.Fatalf("isDeviceLimit(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}

func TestLockedProfileCallsCarryTheRestorePassword(t *testing.T) {
	c, _ := testClient(t)
	seen := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		key := r.Method + " " + r.URL.Path
		switch r.Method {
		case http.MethodDelete:
			seen[key] = r.Header.Get("X-Restore-Password")
		case http.MethodPut:
			seen[key], _ = body["password"].(string)
		case http.MethodPost:
			seen[key], _ = body["restorePassword"].(string)
			_, _ = w.Write([]byte(`{"shareCode":"ABCDEFGH"}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	c.apiURL, c.http = server.URL, server.Client()
	c.state.AccessToken = "a"
	name := "新名字"
	if err := c.UpdateProfile("p1", &name, nil, "rp1"); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteProfile("p1", "rp2"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ShareProfile("p1", "share-pw", "rp3"); err != nil {
		t.Fatal(err)
	}
	if err := c.UnshareProfile("p1", "rp4"); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"PUT /v1/me/config-profiles/p1":          "rp1",
		"DELETE /v1/me/config-profiles/p1":       "rp2",
		"POST /v1/me/config-profiles/p1/share":   "rp3",
		"DELETE /v1/me/config-profiles/p1/share": "rp4",
	}
	for k, v := range want {
		if seen[k] != v {
			t.Fatalf("%s carried %q, want %q", k, seen[k], v)
		}
	}
	if !IsRestorePasswordNeeded(&APIError{Status: 403, Code: "RESTORE_PASSWORD_WRONG"}) {
		t.Fatal("RESTORE_PASSWORD_WRONG should ask for the restore password")
	}
}

func TestSendSMSCodeHonoursServerCooldown(t *testing.T) {
	c, _ := testClient(t)
	reply := `{"ok":true,"cooldownSeconds":90,"message":"sent"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply))
	}))
	defer server.Close()
	c.apiURL, c.http = server.URL, server.Client()
	if got, err := c.SendSMSCode("13800138000", SMSRegister, "tk"); err != nil || got.CooldownSeconds != 90 || got.Message != "sent" {
		t.Fatalf("sent = %+v, %v", got, err)
	}
	reply = `{"ok":true}`
	if got, _ := c.SendSMSCode("13800138000", SMSRegister, "tk"); got.CooldownSeconds != DefaultSMSCooldown {
		t.Fatalf("missing cooldown should default, got %d", got.CooldownSeconds)
	}
}

// The human-verification ticket always travels with the request (empty when
// none was obtained) so the server can tell this client from older ones; the
// server's error code and cooldown come back to the caller.
func TestSendSMSCodeSendsCaptchaTicket(t *testing.T) {
	c, _ := testClient(t)
	var bodies []map[string]any
	status, reply := http.StatusOK, `{"ok":true,"cooldownSeconds":60}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(reply))
	}))
	defer server.Close()
	c.apiURL, c.http = server.URL, server.Client()

	if _, err := c.SendSMSCode("138 0013 8000", SMSRegister, " ticket-1 "); err != nil {
		t.Fatal(err)
	}
	if _, err := c.SendSMSCode("13800138000", SMSReset, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := c.SendSMSCode("13800138000", SMSReset, strings.Repeat("x", MaxCaptchaTicket+1)); err != nil {
		t.Fatal(err)
	}
	want := []string{"ticket-1", "", ""}
	for i, body := range bodies {
		got, present := body["captchaTicket"]
		if !present || got != want[i] {
			t.Fatalf("request %d captchaTicket = %#v (present %v), want %q", i, got, present, want[i])
		}
		if body["phone"] != "13800138000" {
			t.Fatalf("request %d phone = %v", i, body["phone"])
		}
		fp, _ := body["deviceFp"].(string)
		if len(fp) != 32 || fp == c.fingerprint || strings.Contains(c.fingerprint, fp) {
			t.Fatalf("request %d deviceFp = %q, want a derived 32-char id", i, fp)
		}
	}

	status, reply = http.StatusTooManyRequests, `{"error":{"code":"SMS_COOLDOWN","message":"发送太频繁，请 42 秒后再试","cooldownSeconds":42}}`
	sent, err := c.SendSMSCode("13800138000", SMSRegister, "tk")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "SMS_COOLDOWN" || sent.CooldownSeconds != 42 {
		t.Fatalf("cooldown error: sent = %+v, err = %v", sent, err)
	}
	status, reply = http.StatusForbidden, `{"error":{"code":"CAPTCHA_REQUIRED","message":"安全验证未通过或已过期，请重新完成验证"}}`
	sent, err = c.SendSMSCode("13800138000", SMSRegister, "")
	if !errors.As(err, &apiErr) || apiErr.Code != "CAPTCHA_REQUIRED" || sent.CooldownSeconds != 0 || err.Error() != "安全验证未通过或已过期，请重新完成验证" {
		t.Fatalf("captcha error: sent = %+v, err = %v", sent, err)
	}
}
