package accel

import "sync"

// store 是最近请求体缓存：按字节预算淘汰最久没用的，挑与新请求公共前缀最长的当基准。
// 不按会话找：多会话、子代理交错进来，直接比前缀；选错只会压得差一点，中继按 sha256 校验不会出错。
type store struct {
	mu       sync.Mutex
	entries  []entry // 0 = 最近
	bytes    int
	capBytes int
	maxN     int
}

type entry struct {
	sha  Sha
	body []byte
}

func newStore(capBytes, maxN int) *store {
	return &store{capBytes: capBytes, maxN: maxN}
}

func (s *store) insert(sha Sha, body []byte) {
	if len(body) > s.capBytes {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.entries {
		if e.sha == sha {
			copy(s.entries[1:i+1], s.entries[:i])
			s.entries[0] = e
			return
		}
	}
	s.entries = append([]entry{{sha, body}}, s.entries...)
	s.bytes += len(body)
	for s.bytes > s.capBytes || len(s.entries) > s.maxN {
		last := s.entries[len(s.entries)-1]
		s.entries = s.entries[:len(s.entries)-1]
		s.bytes -= len(last.body)
	}
}

// candidates 返回快照（只拷切片头），比对放到锁外
func (s *store) candidates() []entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]entry(nil), s.entries...)
}

// bestBase 在 allowed 里（中继确认已有的）挑公共前缀最长的；前缀覆盖整个候选时提前结束
func bestBase(cands []entry, cur []byte, allowed func(Sha) bool) (entry, int, bool) {
	var best entry
	bp, found := -1, false
	for _, e := range cands {
		if allowed != nil && !allowed(e.sha) {
			continue
		}
		p := commonPrefix(e.body, cur)
		if p > bp {
			best, bp, found = e, p, true
			if p == len(e.body) {
				break
			}
		}
	}
	return best, bp, found
}
