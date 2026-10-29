package license

import (
	"net/http"
	"testing"
)

func TestTongzhiRejectsPathsOutsideAllowList(t *testing.T) {
	c := &Client{}
	cases := []struct{ method, path string }{
		{http.MethodGet, "/../admin/tongzhi/notices"},
		{http.MethodPost, "/bundle"}, // right path, wrong method
		{http.MethodGet, "/notices"},
		{http.MethodDelete, "/read"},
	}
	for _, tc := range cases {
		status, _, err := c.Tongzhi(tc.method, tc.path, nil)
		if err == nil || status != http.StatusNotFound {
			t.Fatalf("%s %s: want 404 rejection, got %d %v", tc.method, tc.path, status, err)
		}
	}
}
