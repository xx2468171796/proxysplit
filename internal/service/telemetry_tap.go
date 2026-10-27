package service

import "sync/atomic"

// logTap receives every line passing through Service.log (app + sing-box core
// output) for the telemetry spool. Kept in its own file so the lifecycle code
// in service.go only carries the single call in log().
type logTap struct{ fn atomic.Pointer[func(string)] }

func (t *logTap) send(line string) {
	if f := t.fn.Load(); f != nil {
		(*f)(line)
	}
}

// SetLogTap installs the telemetry tee (nil to remove). It must not block.
func (s *Service) SetLogTap(fn func(string)) {
	if fn == nil {
		s.tap.fn.Store(nil)
		return
	}
	s.tap.fn.Store(&fn)
}
