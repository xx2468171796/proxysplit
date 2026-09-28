package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/accel"
)

// Claude Code 加速（docs/Claude加速-网关切换.md）：检测到当前线路的落地是我们的（签名验过）且中继通，
// 自动把 Claude Code 切到编码模式；否则保持官方默认。编码端在本进程内，经 sing-box 的 accel-in 入口出去。

// accelHelloKeys 是 PowerVPN 落地身份公钥（私钥只在各落地机中继上，备份在堡垒机资产）
var accelHelloKeys = []string{
	"KNGHviClGWMSmb_f2wveRIP0jN0T63_XwVq7l1qk9z0",
}

const (
	accelListen    = "127.0.0.1:18765" // 固定端口：写进 Claude Code 配置的就是它
	accelRelayHost = "accel.powervpn.internal"
)

type accelRuntime struct {
	eng *accel.Engine
	sw  *accel.Switcher

	mu      sync.Mutex
	token   string
	expires time.Time
}

func (a *App) startAccel() {
	var keys []ed25519.PublicKey
	for _, k := range accelHelloKeys {
		if raw, err := base64.RawURLEncoding.DecodeString(k); err == nil && len(raw) == ed25519.PublicKeySize {
			keys = append(keys, raw)
		}
	}
	rt := &accelRuntime{}
	logf := func(format string, v ...any) { a.svc.Log(fmt.Sprintf(format, v...)) }
	rt.eng = accel.New(accel.Config{
		ListenAddr: accelListen,
		Socks:      a.svc.AccelSocks,
		Token:      func() (string, error) { return a.accelToken(rt) },
		RelayHost:  accelRelayHost,
		HelloKeys:  keys,
		Logf:       logf,
	})
	if _, err := rt.eng.Start(); err != nil {
		runtime.LogWarning(a.ctx, "Claude Code 加速编码端启动失败："+err.Error())
		return
	}
	cfg := &accel.ClaudeSettings{Path: accel.DefaultClaudeSettingsPath(), Snapshot: filepath.Join(dataDir(), "claude-accel-restore.json")}
	rt.sw = accel.NewSwitcher(rt.eng, cfg, accel.Env{Socks: a.svc.AccelSocks, Line: a.svc.AccelLine, Settings: a.svc.AccelSettings}, logf)
	a.accel = rt
	go rt.sw.Run()
}

func (a *App) stopAccel() {
	if a.accel == nil {
		return
	}
	a.accel.sw.Shutdown()
	a.accel.eng.Close()
}

func (a *App) kickAccel() {
	if a.accel != nil {
		a.accel.sw.Kick()
	}
}

// accelToken 缓存服务端签发的令牌，到期前 1 小时换新
func (a *App) accelToken(rt *accelRuntime) (string, error) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.token != "" && time.Until(rt.expires) > time.Hour {
		return rt.token, nil
	}
	if a.lic == nil || !a.lic.Status().Authenticated {
		return "", errors.New("请先登录")
	}
	tok, exp, err := a.lic.AccelToken()
	if err != nil {
		if rt.token != "" && time.Now().Before(rt.expires) {
			return rt.token, nil // 服务端暂时连不上：旧令牌还没过期就接着用
		}
		return "", err
	}
	rt.token, rt.expires = tok, exp
	return tok, nil
}

// GetClaudeAccel 给界面：当前模式、原因、落地、省流统计
func (a *App) GetClaudeAccel() accel.State {
	<-a.ready
	if a.accel == nil {
		return accel.State{Mode: accel.ModeOfficial, Reason: "编码端未启动"}
	}
	return a.accel.sw.State()
}

// SetClaudeAccelMode 用户手动切换：encode = 编码模式，official = 恢复官方默认，auto = 回到自动
func (a *App) SetClaudeAccelMode(mode string) string {
	<-a.ready
	if a.accel == nil {
		return "编码端未启动"
	}
	switch mode {
	case "encode":
		a.accel.sw.SetManual(accel.ModeEncode)
	case "official":
		a.accel.sw.SetManual(accel.ModeOfficial)
	case "auto":
		a.accel.sw.SetManual("")
	default:
		return "未知模式"
	}
	return ""
}
