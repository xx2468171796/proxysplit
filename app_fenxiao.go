package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// FenxiaoResult carries one /v1/fenxiao/* response to the 「推广赚钱」 dialog.
type FenxiaoResult struct {
	Data json.RawMessage `json:"data,omitempty"`
	Err  string          `json:"err,omitempty"`
}

// GetFenxiao reads the user's own referral data. kind is an allow-list key, so the
// frontend can never reach an arbitrary server path through this binding.
func (a *App) GetFenxiao(kind string, level, offset int) FenxiaoResult {
	if a.lic == nil {
		return FenxiaoResult{Err: "授权模块尚未初始化"}
	}
	if offset < 0 {
		offset = 0
	}
	var path string
	switch kind {
	case "me":
		path = "/v1/fenxiao/me"
	case "team":
		path = fmt.Sprintf("/v1/fenxiao/team?limit=20&offset=%d", offset)
		if level > 0 && level <= 20 {
			path += fmt.Sprintf("&level=%d", level)
		}
	case "commissions", "withdrawals":
		path = fmt.Sprintf("/v1/fenxiao/%s?limit=20&offset=%d", kind, offset)
	default:
		return FenxiaoResult{Err: "未知的推广数据类型"}
	}
	data, err := a.lic.Fenxiao(http.MethodGet, path, nil)
	return FenxiaoResult{Data: data, Err: errStr(err)}
}

// RequestFenxiaoWithdrawal asks for a payout of available commission; an admin pays
// it by hand and marks it paid in the back office.
func (a *App) RequestFenxiaoWithdrawal(amountCents int, method, account, name string) FenxiaoResult {
	if a.lic == nil {
		return FenxiaoResult{Err: "授权模块尚未初始化"}
	}
	body := map[string]any{
		"amountCents": amountCents, "method": strings.TrimSpace(method),
		"account": strings.TrimSpace(account), "name": strings.TrimSpace(name),
	}
	data, err := a.lic.Fenxiao(http.MethodPost, "/v1/fenxiao/withdrawals", body)
	return FenxiaoResult{Data: data, Err: errStr(err)}
}
