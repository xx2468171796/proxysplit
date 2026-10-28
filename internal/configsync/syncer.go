package configsync

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"proxysplit/internal/license"
)

// StateFile remembers the last synced cloud version / content hash.
const StateFile = "configsync.json"

// Remote is the cloud copy (license.Client).
type Remote interface {
	ConfigSyncGet(metaOnly bool) (license.SyncMeta, error)
	ConfigSyncPut(payload string, baseVersion int) (int, error)
}

type syncState struct {
	Disabled     bool   `json:"disabled,omitempty"`
	Account      string `json:"account,omitempty"` // signed-in username this state belongs to
	LastVersion  int    `json:"lastVersion"`
	LastHash     string `json:"lastHash"`
	LastSyncedAt string `json:"lastSyncedAt,omitempty"`
}

// Conflict: both this computer and the cloud changed since the last sync.
type Conflict struct {
	CloudVersion   int    `json:"cloudVersion"`
	CloudUpdatedAt string `json:"cloudUpdatedAt"`
	CloudDevice    string `json:"cloudDevice"`
}

// Status is what the settings page shows.
type Status struct {
	Member       bool      `json:"member"`
	Enabled      bool      `json:"enabled"`
	Busy         bool      `json:"busy"`
	LastSyncedAt string    `json:"lastSyncedAt"`
	LastVersion  int       `json:"lastVersion"`
	LocalChanged bool      `json:"localChanged"`
	Error        string    `json:"error,omitempty"`
	Conflict     *Conflict `json:"conflict,omitempty"`
	CanUndo      bool      `json:"canUndo"`
	UndoAt       string    `json:"undoAt,omitempty"`
}

// Syncer keeps the live config and the member's cloud copy in step.
type Syncer struct {
	mu       sync.Mutex
	run      sync.Mutex // one network round at a time
	dir      string
	device   string
	store    Store
	remote   Remote
	member   func() bool
	account  func() string // signed-in account identity (username)
	notify   func(Status)
	st       syncState
	pending  string // hash seen on the previous tick (debounce)
	busy     bool
	lastErr  string
	conflict *Conflict
	now      func() time.Time
}

// NewSyncer loads the sync state from dir. notify may be nil.
func NewSyncer(dir, device string, store Store, remote Remote, member func() bool, account func() string, notify func(Status)) *Syncer {
	s := &Syncer{dir: dir, device: device, store: store, remote: remote, member: member, account: account, notify: notify, now: time.Now}
	if raw, err := os.ReadFile(filepath.Join(dir, StateFile)); err == nil {
		_ = json.Unmarshal(raw, &s.st)
	}
	return s
}

func (s *Syncer) saveLocked() {
	raw, _ := json.MarshalIndent(s.st, "", "  ")
	_ = writeFileAtomic(filepath.Join(s.dir, StateFile), raw)
}

// Status snapshots the sync state.
func (s *Syncer) Status() Status {
	s.mu.Lock()
	st := Status{Member: s.member(), Enabled: !s.st.Disabled, Busy: s.busy, LastSyncedAt: s.st.LastSyncedAt, LastVersion: s.st.LastVersion, Error: s.lastErr, Conflict: s.conflict}
	last := s.st.LastHash
	s.mu.Unlock()
	if h, err := SyncHash(s.store); err == nil {
		st.LocalChanged = h != last
	}
	st.CanUndo, st.UndoAt = CanUndo(s.dir)
	return st
}

func (s *Syncer) emit() {
	if s.notify != nil {
		s.notify(s.Status())
	}
}

// SetEnabled turns automatic sync on / off (manual 立即同步 still works).
func (s *Syncer) SetEnabled(on bool) {
	s.mu.Lock()
	s.st.Disabled = !on
	s.pending = ""
	s.saveLocked()
	s.mu.Unlock()
	s.emit()
	if on {
		go func() { _ = s.SyncNow() }()
	}
}

func (s *Syncer) auto() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.st.Disabled && s.conflict == nil && s.member()
}

// Tick runs every few seconds: a local change that stayed unchanged for one
// whole tick (the debounce) is uploaded.
func (s *Syncer) Tick() {
	if !s.auto() {
		return
	}
	h, err := SyncHash(s.store)
	if err != nil {
		return
	}
	s.mu.Lock()
	changed := h != s.st.LastHash
	stable := h == s.pending
	s.pending = h
	s.mu.Unlock()
	if changed && stable {
		_ = s.SyncNow()
	}
}

// Startup reconciles once after launch / sign-in (members with sync on).
func (s *Syncer) Startup() {
	if s.auto() {
		_ = s.SyncNow()
	}
}

func (s *Syncer) setBusy(on bool, err error) {
	s.mu.Lock()
	s.busy = on
	if !on {
		s.lastErr = ""
		if err != nil && !errors.Is(err, license.ErrSyncConflict) {
			s.lastErr = err.Error()
			if license.IsMemberOnly(err) {
				s.lastErr = "云同步是会员功能，开通会员后自动同步"
			}
		}
	}
	s.mu.Unlock()
	s.emit()
}

// SyncNow compares local and cloud and pulls, pushes or reports a conflict.
func (s *Syncer) SyncNow() (err error) {
	if !s.member() {
		return errors.New("云同步是会员功能，开通会员后可用")
	}
	s.run.Lock()
	defer s.run.Unlock()
	s.setBusy(true, nil)
	defer func() { s.setBusy(false, err) }()
	s.ensureAccount()
	local, err := s.snapshot()
	if err != nil {
		return err
	}
	meta, err := s.remote.ConfigSyncGet(true)
	if err != nil {
		return err
	}
	s.mu.Lock()
	st := s.st
	s.mu.Unlock()
	localHash := local.Hash()
	changed := localHash != st.LastHash
	switch {
	case !meta.Exists:
		return s.push(local, 0)
	case meta.Version > st.LastVersion:
		// Never synced on this computer (LastHash "") also counts as changed:
		// a fresh install must not silently replace the cloud or vice versa.
		return s.cloudNewer(local, changed)
	case changed:
		return s.push(local, meta.Version)
	}
	return nil
}

// cloudNewer: the cloud moved on. Same content → just record it; untouched
// local config → pull; otherwise ask the user.
func (s *Syncer) cloudNewer(local Bundle, localDirty bool) error {
	full, err := s.remote.ConfigSyncGet(false)
	if err != nil {
		return err
	}
	cloud, err := s.parseCloud(full.Payload)
	if err != nil {
		return err
	}
	if cloud.Hash() == local.Hash() {
		s.record(full.Version, local.Hash())
		return nil
	}
	if localDirty {
		s.mu.Lock()
		s.conflict = &Conflict{CloudVersion: full.Version, CloudUpdatedAt: full.UpdatedAt, CloudDevice: full.DeviceName}
		s.mu.Unlock()
		return license.ErrSyncConflict
	}
	return s.pull(cloud, full.Version, false)
}

// pull applies a cloud copy. Automatic pulls back up to SyncBackupFile; a
// user-chosen conflict resolution (manual) backs up to BackupFile so it can
// be undone like an import. Either way the selected node stays.
func (s *Syncer) pull(cloud Bundle, version int, manual bool) error {
	backup := SyncBackupFile
	if manual {
		backup = BackupFile
	}
	if err := apply(s.store, filepath.Join(s.dir, backup), cloud, nil, modeSync); err != nil {
		return err
	}
	h, err := SyncHash(s.store)
	if err != nil {
		return err
	}
	s.record(version, h)
	return nil
}

func (s *Syncer) push(local Bundle, base int) error {
	payload, err := local.Encode()
	if err != nil {
		return err
	}
	v, err := s.remote.ConfigSyncPut(payload, base)
	if errors.Is(err, license.ErrSyncConflict) {
		// Without the cloud metadata the conflict dialog would show version 0:
		// surface the fetch error instead of a bogus conflict.
		meta, merr := s.remote.ConfigSyncGet(true)
		if merr != nil {
			return errors.New("云端配置已被其他设备更新，但读取云端信息失败：" + merr.Error())
		}
		s.mu.Lock()
		s.conflict = &Conflict{CloudVersion: meta.Version, CloudUpdatedAt: meta.UpdatedAt, CloudDevice: meta.DeviceName}
		s.mu.Unlock()
		return err
	}
	if err != nil {
		return err
	}
	s.record(v, local.Hash())
	return nil
}

func (s *Syncer) record(version int, hash string) {
	s.mu.Lock()
	s.st.LastVersion, s.st.LastHash, s.st.LastSyncedAt = version, hash, s.now().Format(time.RFC3339)
	s.conflict, s.pending = nil, hash
	s.saveLocked()
	s.mu.Unlock()
}

// Resolve settles a conflict: "cloud" replaces the local config with the
// cloud copy (backed up first, undoable); "local" overwrites the cloud.
func (s *Syncer) Resolve(choice string) (err error) {
	if choice != "cloud" && choice != "local" {
		return errors.New("请选择用云端还是用本机的配置")
	}
	s.run.Lock()
	defer s.run.Unlock()
	s.setBusy(true, nil)
	defer func() { s.setBusy(false, err) }()
	if s.ensureAccount() {
		return errors.New("登录账号已切换，请重新同步")
	}
	full, err := s.remote.ConfigSyncGet(choice == "local")
	if err != nil {
		return err
	}
	if choice == "local" {
		local, err := s.snapshot()
		if err != nil {
			return err
		}
		return s.push(local, full.Version)
	}
	cloud, err := s.parseCloud(full.Payload)
	if err != nil {
		return err
	}
	return s.pull(cloud, full.Version, true)
}

// snapshot is the live config as cloud sync carries it (no selected node).
func (s *Syncer) snapshot() (Bundle, error) {
	b, err := Snapshot(s.store, s.device)
	if err != nil {
		return Bundle{}, err
	}
	return b.ForSync(), nil
}

func (s *Syncer) parseCloud(payload string) (Bundle, error) {
	b, err := Parse(payload)
	if err != nil {
		return Bundle{}, err
	}
	return b.ForSync(), nil
}

// ensureAccount forgets the bookkeeping when it belongs to another account
// than the signed-in one (account switch without sign-out), so that
// account's version / hash can never make this one push or pull wrongly.
// It reports whether a switch was detected.
func (s *Syncer) ensureAccount() bool {
	cur := ""
	if s.account != nil {
		cur = s.account()
	}
	s.mu.Lock()
	same := s.st.Account == cur
	s.mu.Unlock()
	if same {
		return false
	}
	s.Forget()
	s.mu.Lock()
	s.st.Account = cur
	s.saveLocked()
	s.mu.Unlock()
	return true
}

// Forget clears the sync bookkeeping (sign-out / account switch) so another
// account's cloud copy is never treated as "already synced".
func (s *Syncer) Forget() {
	s.mu.Lock()
	disabled := s.st.Disabled
	s.st = syncState{Disabled: disabled}
	s.conflict, s.pending, s.lastErr = nil, "", ""
	s.saveLocked()
	s.mu.Unlock()
}
