package license

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
	reply := `{"ok":true,"cooldownSeconds":90}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply))
	}))
	defer server.Close()
	c.apiURL, c.http = server.URL, server.Client()
	if got, err := c.SendSMSCode("13800138000", SMSRegister); err != nil || got != 90 {
		t.Fatalf("cooldown = %d, %v", got, err)
	}
	reply = `{"ok":true}`
	if got, _ := c.SendSMSCode("13800138000", SMSRegister); got != DefaultSMSCooldown {
		t.Fatalf("missing cooldown should default, got %d", got)
	}
}
