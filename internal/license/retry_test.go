package license

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateOrderDoesNotReplayOnServerFailure(t *testing.T) {
	var orders, refreshes int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/orders":
			orders++
			http.Error(w, `{"error":{"message":"temporary"}}`, http.StatusBadGateway)
		case "/v1/auth/refresh":
			refreshes++
			_ = json.NewEncoder(w).Encode(map[string]string{"accessToken": "new-access", "refreshToken": "new-refresh"})
		}
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat",
		fingerprint: "fingerprint", state: state{AccessToken: "access", RefreshToken: "refresh"}}
	if _, err := c.CreateOrder("plan", ""); err == nil {
		t.Fatal("expected create order failure")
	}
	if orders != 1 || refreshes != 0 {
		t.Fatalf("non-auth failure was replayed: orders=%d refreshes=%d", orders, refreshes)
	}
}

func TestCreateOrderRefreshesAndRetriesOnlyOnUnauthorized(t *testing.T) {
	var orders, refreshes int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/orders":
			orders++
			if orders == 1 {
				http.Error(w, `{"error":{"message":"expired"}}`, http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(Checkout{Order: Order{OrderNo: "PS1"}})
		case "/v1/auth/refresh":
			refreshes++
			_ = json.NewEncoder(w).Encode(map[string]string{"accessToken": "new-access", "refreshToken": "new-refresh"})
		}
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat",
		fingerprint: "fingerprint", state: state{AccessToken: "access", RefreshToken: "refresh"}}
	order, err := c.CreateOrder("plan", "")
	if err != nil || order.Order.OrderNo != "PS1" {
		t.Fatalf("retry after 401 failed: order=%+v err=%v", order, err)
	}
	if orders != 2 || refreshes != 1 {
		t.Fatalf("unexpected calls: orders=%d refreshes=%d", orders, refreshes)
	}
}

func TestUnbindDeviceSendsNoJSONContentTypeWithoutBody(t *testing.T) {
	var contentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		if r.Method != http.MethodDelete {
			t.Fatalf("method=%s", r.Method)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat",
		state: state{AccessToken: "access", DeviceID: "current-device"}}
	if err := c.UnbindDevice("old-device"); err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		t.Fatalf("bodyless DELETE advertised JSON content: %q", contentType)
	}
}

func TestCreateOrderSendsHumanVerifyTokenAndKeepsErrorCode(t *testing.T) {
	var bodies []map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		if body["hvToken"] == "" {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"code":"PAY_CHALLENGE_REQUIRED","message":"请先完成安全验证"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(Checkout{Order: Order{OrderNo: "PS2"}})
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat",
		fingerprint: "fingerprint", state: state{AccessToken: "access", RefreshToken: "refresh"}}
	_, err := c.CreateOrder("plan", "  ")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "PAY_CHALLENGE_REQUIRED" {
		t.Fatalf("want PAY_CHALLENGE_REQUIRED, got %v", err)
	}
	if _, ok := bodies[0]["hvToken"]; ok {
		t.Fatal("blank token must not be sent")
	}
	order, err := c.CreateOrder("plan", "tok")
	if err != nil || order.Order.OrderNo != "PS2" || bodies[1]["hvToken"] != "tok" {
		t.Fatalf("token order failed: order=%+v err=%v body=%v", order, err, bodies[1])
	}
}

// The catalog answer also says how to pay right now and how many devices the
// free tier gets; an older server sends neither.
func TestCatalogCarriesPaymentMethodsAndFreeDevices(t *testing.T) {
	body := `{"items":[{"id":"p1","name":"普通会员"}],"paymentMethods":["wechat"],"freeDevices":2}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/catalog/plans" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	c := &Client{apiURL: server.URL, http: server.Client(), path: t.TempDir() + "/license.dat", fingerprint: "fingerprint"}
	cat, err := c.Catalog()
	if err != nil || len(cat.Items) != 1 || len(cat.PaymentMethods) != 1 || cat.PaymentMethods[0] != "wechat" || cat.FreeDevices == nil || *cat.FreeDevices != 2 {
		t.Fatalf("catalog = %+v, err %v", cat, err)
	}
	body = `{"items":[]}`
	if cat, err = c.Catalog(); err != nil || cat.FreeDevices != nil || len(cat.PaymentMethods) != 0 {
		t.Fatalf("older server: catalog = %+v, err %v", cat, err)
	}
}
