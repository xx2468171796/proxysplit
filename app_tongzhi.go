package main

import "encoding/json"

// TongzhiResult is one forwarded inbox response for the UI's tongzhi client
// (status 0 = the request never reached the server).
type TongzhiResult struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body,omitempty"`
	Err    string          `json:"err,omitempty"`
}

// TongzhiCall forwards a 消息中心 request (path is under /v1/tongzhi and is
// allow-listed in the license client).
func (a *App) TongzhiCall(method, path, body string) TongzhiResult {
	if a.lic == nil {
		return TongzhiResult{Err: "授权模块尚未初始化"}
	}
	status, data, err := a.lic.Tongzhi(method, path, json.RawMessage(body))
	return TongzhiResult{Status: status, Body: data, Err: errStr(err)}
}
