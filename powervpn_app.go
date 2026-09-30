package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/powervpn"
)

// POWER云 账号（PowerVPN 面板）：OAuth 登录 → ProxySplit 账号登录 + 自动添加「POWER云」订阅。

// PowerVPNStatus is shown on the login page / settings.
type PowerVPNStatus struct {
	LoggedIn bool   `json:"loggedIn"`
	Username string `json:"username"`
}

func (a *App) powervpn() (*powervpn.Client, error) {
	<-a.ready
	if a.initErr != nil || a.svc == nil {
		return nil, errors.New("程序尚未初始化完成")
	}
	if a.pv == nil {
		a.pv = powervpn.New(dataDir(), appVersion)
		a.svc.SetPowerVPN(a.pv)
	}
	return a.pv, nil
}

// initPowerVPN wires the panel client into the service at startup.
func (a *App) initPowerVPN() {
	a.pv = powervpn.New(dataDir(), appVersion)
	a.svc.SetPowerVPN(a.pv)
}

// GetPowerVPNStatus reports the POWER云 account on this device.
func (a *App) GetPowerVPNStatus() PowerVPNStatus {
	pv, err := a.powervpn()
	if err != nil {
		return PowerVPNStatus{}
	}
	return PowerVPNStatus{LoggedIn: pv.LoggedIn(), Username: pv.Username()}
}

// LoginPowerVPN opens the browser for POWER云 authorization (≤ 5 minutes),
// signs in to ProxySplit with that account (same device limits as a password
// login; membership rules unchanged) and adds the "POWER云" subscription.
// Returns "" on success or a Chinese error message.
func (a *App) LoginPowerVPN() string {
	pv, err := a.powervpn()
	if err != nil {
		return err.Error()
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	// 中转站客户：直接打开 POWER云「用 AI 编程官网账号登录」入口，登录完回到授权页（少点一次）。
	viaAIGW := a.lic != nil && a.licenseStatus().Channel == channelAIGW
	if err := pv.Login(ctx, func(u string) error {
		if viaAIGW {
			u = aigwStartURL(u)
		}
		runtime.BrowserOpenURL(a.ctx, u)
		return nil
	}); err != nil {
		return err.Error()
	}
	return a.finishPowerVPNLogin(ctx, pv)
}

// finishPowerVPNLogin runs after a POWER云 grant was stored (browser login or
// download ticket): ProxySplit sign-in with that account, preset apps for
// AI-site customers, the "POWER云" subscription. Same return contract as
// LoginPowerVPN. Doesn't wait for a.ready (the download-ticket login runs
// inside startup).
func (a *App) finishPowerVPNLogin(ctx context.Context, pv *powervpn.Client) string {
	if a.lic != nil && a.lic.Enabled() {
		tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		tok, err := pv.AccessToken(tctx)
		cancel()
		if err != nil {
			return err.Error()
		}
		if err := a.lic.LoginWithPowerVPN(tok); err != nil {
			return err.Error()
		}
	}
	// 中转站客户第一次登录：应用分流还是空的就把常用程序加好，点「启动」就能用。
	if a.licenseStatus().Channel == channelAIGW && len(a.svc.GetAppRules()) == 0 {
		if msg := a.svc.SetAppRules(aigwDefaultApps()); msg != "" {
			a.svc.LogLine("[中转站] 预置常用程序失败：" + msg)
		}
	}
	if err := a.svc.EnsurePowerVPNSub(); err != nil {
		// 账号已登录，只是线路暂不可用（如设备数已满 / 未购买）：提示但不算登录失败。
		a.svc.LogLine("[POWER云] " + err.Error())
		return "NOTICE:" + fmt.Sprintf("已登录 POWER云，但线路暂不可用：%s", err.Error())
	}
	return ""
}

// RefreshPowerVPN re-fetches the POWER云 profile now.
func (a *App) RefreshPowerVPN() string {
	if _, err := a.powervpn(); err != nil {
		return err.Error()
	}
	return errStr(a.svc.EnsurePowerVPNSub())
}

// LogoutPowerVPN forgets the POWER云 grant and removes its subscription.
func (a *App) LogoutPowerVPN() string {
	pv, err := a.powervpn()
	if err != nil {
		return err.Error()
	}
	a.svc.RemovePowerVPNSub()
	return errStr(pv.Logout())
}
