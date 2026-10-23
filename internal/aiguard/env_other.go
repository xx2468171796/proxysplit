//go:build !windows

package aiguard

func ProxyEnv() map[string]string { return nil }
