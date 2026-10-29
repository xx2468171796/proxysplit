package logfile

import "regexp"

// reMobile finds mainland mobile numbers (11 digits starting 13–19, optional
// +86 / 86) not embedded in a longer digit run.
var reMobile = regexp.MustCompile(`(^|[^0-9])((?:\+?86)?1[3-9][0-9])([0-9]{6})([0-9]{2})($|[^0-9])`)

// maskPhones keeps the first 3 and last 2 digits of phone numbers, matching
// telemetry.MaskAccount. The telemetry sanitiser does not cover phones.
func maskPhones(s string) string {
	for range 2 { // adjacent numbers share a separator; a second pass catches them
		s = reMobile.ReplaceAllString(s, "${1}${2}******${4}${5}")
	}
	return s
}
