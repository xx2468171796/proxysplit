//go:build !windows && !darwin

package aienv

// Off Windows only the Claude Code switch applies.
var items = []item{claudeItem}

const (
	TaipeiTimezone = "Taipei Standard Time"
	ChinaTimezone  = "China Standard Time"
)

func TimezoneID() string          { return "" }
func UserLocale() string          { return "" }
func BrowserLanguageForced() bool { return false }
func BrowserLanguages() string    { return "" }
func resyncClock() error          { return errUnsupported }
