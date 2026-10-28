package main

import (
	"time"

	"proxysplit/internal/telemetry"
)

// Phone-number accounts: SMS code, phone registration, password reset and
// binding a phone to an older account. "" = success, else a Chinese message.

// SMSSendResult: Err "" = sent; CooldownSeconds is the server's resend wait.
type SMSSendResult struct {
	CooldownSeconds int    `json:"cooldownSeconds"`
	Err             string `json:"err,omitempty"`
}

// SendSMSCode texts a code; purpose is register / reset / bind.
func (a *App) SendSMSCode(phone, purpose string) SMSSendResult {
	if a.lic == nil {
		return SMSSendResult{Err: "授权模块尚未初始化"}
	}
	cooldown, err := a.lic.SendSMSCode(phone, purpose)
	return SMSSendResult{CooldownSeconds: cooldown, Err: errStr(err)}
}

// RegisterPhone creates an account with phone + SMS code and signs in.
func (a *App) RegisterPhone(phone, code, username, password, ref string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	err := tmErr(telemetry.AccountRegister, time.Now(), map[string]any{"withRef": ref != "", "phone": true}, a.lic.RegisterPhone(phone, code, username, password, ref))
	if err != nil {
		return err.Error()
	}
	a.afterSignIn()
	return ""
}

// ResetPassword sets a new password by SMS (once per phone per day).
func (a *App) ResetPassword(phone, code, password string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	return errStr(a.lic.ResetPassword(phone, code, password))
}

// BindPhone attaches a phone number to the signed-in account; changing an
// already bound phone needs currentPassword (the login password).
func (a *App) BindPhone(phone, code, currentPassword string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	return errStr(a.lic.BindPhone(phone, code, currentPassword))
}

// RefreshAccountProfile re-reads phone / device split from the server.
func (a *App) RefreshAccountProfile() string {
	if a.lic == nil {
		return ""
	}
	return errStr(a.lic.RefreshProfile())
}
