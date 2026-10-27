//go:build !windows

package capture

import "errors"

// Engine is Windows-only (WinDivert); elsewhere Start always fails.
type Engine struct{}

// Options configures Start.
type Options struct {
	DLLPath string
	Exclude []string
	Log     func(string)
}

// Start is unsupported off Windows.
func Start(Options, *Routes) (*Engine, error) {
	return nil, errors.New("仅接管选中程序只支持 Windows")
}

func (e *Engine) SetRoutes(*Routes) {}
func (e *Engine) Flows() int        { return 0 }
func (e *Engine) Stop()             {}
