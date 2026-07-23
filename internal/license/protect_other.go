//go:build !windows

package license

func protect(input []byte) ([]byte, error)   { return append([]byte(nil), input...), nil }
func unprotect(input []byte) ([]byte, error) { return append([]byte(nil), input...), nil }
