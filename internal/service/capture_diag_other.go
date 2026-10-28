//go:build !windows

package service

// captureDiag: the WinDivert diagnosis exists only on Windows.
func (s *Service) captureDiag() string { return "" }
