package telemetry

// Upload contract limits. This block mirrors the server's
// server/packages/contracts/src/telemetry.ts (telemetryEventSchema,
// telemetryLogChunkSchema, telemetryBatchSchema) and the request size caps in
// server/apps/api/src/telemetry-routes.ts; TestLimitsMirrorContract reads
// those files and fails when a number here drifts.
//
// The server answers 400 to the WHOLE batch when one field is over its limit,
// so every field is cut to its limit before it is sent (clampEvent,
// clampMeta, segmentParts). String limits are JavaScript string lengths, i.e.
// UTF-16 code units — not bytes and not runes; use utf16Len / truncate.
const (
	limitErrorText     = 4000              // event.errorText
	limitSessionID     = 64                // event.sessionId, logChunk.sessionId
	limitEventType     = 64                // event.type
	limitDurationMs    = 86_400_000        // event.durationMs
	limitSeq           = 1_000_000_000_000 // event.seq
	limitChunkText     = 1_000_000         // logChunk.text
	limitChunkLines    = 100_000           // logChunk.lineCount
	limitBatchEvents   = 2000              // batch.events
	limitBatchLogs     = 50                // batch.logs
	limitAppVersion    = 40                // batch.appVersion
	limitCoreVersion   = 120               // batch.coreVersion
	limitOS            = 160               // batch.os
	limitArch          = 20                // batch.arch
	limitAccountHint   = 120               // batch.accountHint
	limitGzipBodyBytes = 512 * 1024        // request body after gzip (TELEMETRY_MAX_GZIP_BYTES default)
	limitBodyBytes     = 4 * 1024 * 1024   // request body before gzip (TELEMETRY_MAX_BODY_BYTES)
)

// Client-side sizes derived from the limits above.
const (
	// maxLineLen caps one sanitised log line / error text, suffix included. It
	// equals the tightest per-string limit so an error text never needs a
	// second cut.
	maxLineLen = limitErrorText
	// chunkFlushBytes: a log chunk is closed once it holds this many bytes
	// (bytes ≥ UTF-16 units, so it stays far below limitChunkText).
	chunkFlushBytes = 256 << 10
	// mergeBytes: sealed segments are merged into one request while their
	// files add up to at most this. gzip never grows its input by more than a
	// few bytes, so staying under the gzip cap before compression means the
	// request can never be rejected for size.
	mergeBytes = limitGzipBodyBytes - 64<<10
	// mergeSegments bounds how many files one request may cover.
	mergeSegments = 64
	// maxRequestsPerRound: uploads per tick / kick, so a long backlog is sent
	// over several rounds instead of as one burst.
	maxRequestsPerRound = 20
)

const truncatedSuffix = "…[truncated]"

// utf16Len is the JavaScript length of s (what the server's z.string().max()
// counts): one unit per rune, two for runes outside the BMP.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// truncate cuts s on a rune boundary so that its JavaScript length, suffix
// included, is at most max.
func truncate(s string, max int) string {
	if len(s) <= max || utf16Len(s) <= max { // bytes ≥ units: the cheap test first
		return s
	}
	budget := max - utf16Len(truncatedSuffix)
	if budget < 0 {
		budget = 0
	}
	n := 0
	for i, r := range s {
		w := 1
		if r >= 0x10000 {
			w = 2
		}
		if n+w > budget {
			return s[:i] + truncatedSuffix
		}
		n += w
	}
	return s
}
