// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
)

var locks sync.Map

// Store 不缓存记录正文。各工作空间的短写锁跨 Store 实例共享。
type Store struct {
	dataDir string
	mu      *sync.Mutex
}

func NewStore(dataDir string) *Store {
	path := filepath.Clean(dataDir)
	m, _ := locks.LoadOrStore(path, &sync.Mutex{})
	return &Store{path, m.(*sync.Mutex)}
}
func (s *Store) root(create bool) (*os.Root, error) {
	root, err := os.OpenRoot(s.dataDir)
	if err != nil {
		return nil, err
	}
	for _, part := range []string{"storage", "ai", "memos"} {
		if create {
			if err = root.Mkdir(part, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				root.Close()
				return nil, err
			}
		}
		info, e := root.Lstat(part)
		if e != nil {
			root.Close()
			return nil, e
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			root.Close()
			return nil, ErrInvalid
		}
		next, e := root.OpenRoot(part)
		root.Close()
		if e != nil {
			return nil, e
		}
		root = next
	}
	return root, nil
}
func subroot(root *os.Root, name string, create bool) (*os.Root, error) {
	if create {
		if e := root.Mkdir(name, 0700); e != nil && !errors.Is(e, os.ErrExist) {
			return nil, e
		}
	}
	i, e := root.Lstat(name)
	if e != nil {
		return nil, e
	}
	if !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
		return nil, ErrInvalid
	}
	return root.OpenRoot(name)
}
func readFile(root *os.Root, name string) ([]byte, error) {
	i, e := root.Lstat(name)
	if e != nil {
		return nil, e
	}
	if !i.Mode().IsRegular() || i.Size() > MaxFileSize {
		return nil, ErrInvalid
	}
	f, e := root.Open(name)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	data, e := io.ReadAll(io.LimitReader(f, MaxFileSize+1))
	if e != nil {
		return nil, e
	}
	if len(data) > MaxFileSize {
		return nil, ErrInvalid
	}
	return data, nil
}
func writeFile(root *os.Root, name string, data []byte) error {
	// 临时文件与目标同目录；不覆盖链接或特殊文件。
	if info, e := root.Lstat(name); e == nil && !info.Mode().IsRegular() {
		return ErrInvalid
	} else if e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	temp := ".pending-" + NewID()
	f, e := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer root.Remove(temp)
	if _, e = f.Write(data); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = root.Rename(temp, name); e != nil {
		return e
	}
	// Windows 不支持目录 fsync；文件内容已同步后才替换名称。
	if runtime.GOOS != "windows" {
		dir, err := root.Open(".")
		if err != nil {
			return err
		}
		defer dir.Close()
		return dir.Sync()
	}
	return nil
}
func (s *Store) get(root *os.Root, id string) (Entry, error) {
	if !idPattern.MatchString(id) {
		return Entry{}, ErrInvalid
	}
	rr, e := subroot(root, "records", false)
	if e != nil {
		return Entry{}, e
	}
	defer rr.Close()
	data, e := readFile(rr, id+".md")
	if e != nil {
		return Entry{}, e
	}
	return DecodeRecord(data, id)
}
func eachFile(ctx context.Context, root *os.Root, fn func(string, []byte) error) error {
	d, e := root.Open(".")
	if e != nil {
		return e
	}
	defer d.Close()
	for {
		entries, e := d.ReadDir(32)
		for _, entry := range entries {
			if err := checkContext(ctx); err != nil {
				return err
			}
			name := entry.Name()
			if strings.HasPrefix(name, ".pending-") {
				continue
			}
			if !strings.HasSuffix(name, ".md") {
				return ErrInvalid
			}
			if entry.IsDir() {
				return ErrInvalid
			}
			data, err := readFile(root, name)
			if err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			if err = fn(name, data); err != nil {
				return err
			}
		}
		if e == io.EOF {
			return nil
		}
		if e != nil {
			return e
		}
	}
}
func (s *Store) withdrawals(ctx context.Context, root *os.Root) ([]withdrawal, error) {
	wr, e := subroot(root, "withdrawals", false)
	if errors.Is(e, os.ErrNotExist) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	defer wr.Close()
	var ret []withdrawal
	e = eachFile(ctx, wr, func(name string, data []byte) error {
		if e := ValidateWithdrawal(data, strings.TrimSuffix(name, ".md")); e != nil {
			return e
		}
		var w withdrawal
		body, e := decode(data, &w)
		if e != nil {
			return e
		}
		if body != "" || !idPattern.MatchString(w.ID) || name != w.ID+".md" || !idPattern.MatchString(w.Target) || w.Operation == "" || w.Created == "" {
			return ErrInvalid
		}
		for _, source := range w.Sources {
			if source.ID == "" || source.Kind == "" || source.Evidence != "" {
				return ErrInvalid
			}
		}
		ret = append(ret, w)
		return nil
	})
	return ret, e
}
func withdrawn(r Record, ws []withdrawal) bool {
	for _, w := range ws {
		if w.Target == r.ID {
			return true
		}
		if contains(r.Authorizations, withdrawalAuthorization(w)) {
			continue
		}
		preserved := false
		for _, survivor := range w.Survivors {
			if survivor.ID == r.ID && survivor.Fact == withdrawalFact(r) {
				preserved = true
				break
			}
		}
		if preserved {
			continue
		}
		for _, a := range w.Sources {
			for _, b := range r.Sources {
				if a.Kind == b.Kind && a.ID == b.ID {
					return true
				}
			}
		}
	}
	return false
}
func (s *Store) Get(ctx context.Context, id string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(false)
	if e != nil {
		return Entry{}, e
	}
	defer root.Close()
	ws, e := s.withdrawals(ctx, root)
	if e != nil {
		return Entry{}, e
	}
	entry, e := s.get(root, id)
	if e != nil {
		return Entry{}, e
	}
	conflict, e := hasConflict(root, id)
	if e != nil {
		return Entry{}, e
	}
	if conflict {
		return Entry{}, ErrConflict
	}
	if withdrawn(entry.Record, ws) {
		return Entry{}, ErrWithdrawn
	}
	return entry, nil
}
func (s *Store) FindOperation(ctx context.Context, operationID string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(false)
	if e != nil {
		return Entry{}, e
	}
	defer root.Close()
	entry, e := s.findOperation(ctx, root, operationID)
	if e != nil {
		return Entry{}, e
	}
	ws, e := s.withdrawals(ctx, root)
	if e != nil {
		return Entry{}, e
	}
	if withdrawn(entry.Record, ws) {
		return Entry{}, ErrWithdrawn
	}
	conflict, e := hasConflict(root, entry.Record.ID)
	if e != nil {
		return Entry{}, e
	}
	if conflict {
		return Entry{}, ErrConflict
	}
	return entry, nil
}

var errFound = errors.New("found")

func (s *Store) findOperation(ctx context.Context, root *os.Root, op string) (Entry, error) {
	rr, e := subroot(root, "records", false)
	if e != nil {
		return Entry{}, e
	}
	defer rr.Close()
	var result Entry
	e = eachFile(ctx, rr, func(name string, data []byte) error {
		entry, e := DecodeRecord(data, strings.TrimSuffix(name, ".md"))
		if e != nil {
			return e
		}
		if contains(entry.Record.Operations, op) {
			result = entry
			return errFound
		}
		return nil
	})
	if e == errFound {
		return result, nil
	}
	if e != nil {
		return Entry{}, e
	}
	return Entry{}, os.ErrNotExist
}
func (s *Store) Save(ctx context.Context, r Record, expectedRevision, operationID string) (Entry, error) {
	return s.save(ctx, r, expectedRevision, operationID, false, nil)
}
func (s *Store) Remember(ctx context.Context, r Record, expectedRevision, operationID string) (Entry, error) {
	return s.save(ctx, r, expectedRevision, operationID, true, nil)
}

// GuardedSave 的 guard 在最终提交的短锁内检查配置许可，不得再次调用 Store。
func (s *Store) GuardedSave(ctx context.Context, r Record, expectedRevision, operationID string, guard func() error) (Entry, error) {
	return s.save(ctx, r, expectedRevision, operationID, false, guard)
}
func (s *Store) GuardedRemember(ctx context.Context, r Record, expectedRevision, operationID string, guard func() error) (Entry, error) {
	return s.save(ctx, r, expectedRevision, operationID, true, guard)
}

// GuardedProposal 对替代提案的引用目标一起复核修订，不修改或自动停用该目标。
func (s *Store) GuardedProposal(ctx context.Context, r Record, expectedRevision, operationID string, reference *Entry, guard func() error) (Entry, error) {
	if reference == nil {
		return s.save(ctx, r, expectedRevision, operationID, false, guard)
	}
	return s.save(ctx, r, expectedRevision, operationID, false, guard, *reference)
}
func (s *Store) save(ctx context.Context, r Record, expected, op string, explicit bool, guard func() error, references ...Entry) (Entry, error) {
	if op == "" || len(op) > 256 {
		return Entry{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := checkContext(ctx); e != nil {
		return Entry{}, e
	}
	root, e := s.root(true)
	if e != nil {
		return Entry{}, e
	}
	defer root.Close()
	rr, e := subroot(root, "records", true)
	if e != nil {
		return Entry{}, e
	}
	defer rr.Close()
	ws, e := s.withdrawals(ctx, root)
	if e != nil {
		return Entry{}, e
	}
	prior, e := s.findOperation(ctx, root, op)
	if e == nil {
		conflict, err := hasConflict(root, prior.Record.ID)
		if err != nil {
			return Entry{}, err
		}
		if conflict {
			return Entry{}, ErrConflict
		}
		if withdrawn(prior.Record, ws) {
			return Entry{}, ErrWithdrawn
		}
		return prior, nil
	}
	if !errors.Is(e, os.ErrNotExist) {
		return Entry{}, e
	}
	for _, w := range ws {
		if w.Operation == op || contains(w.OperationHashes, revision([]byte(op))) {
			return Entry{}, ErrWithdrawn
		}
		// 旧版撤回没有操作摘要；显式用户来源仍保留其创建操作身份。
		for _, source := range w.Sources {
			if source.Kind == "user" && source.ID == op {
				return Entry{}, ErrWithdrawn
			}
		}
	}
	if r.ID == "" {
		r.ID = NewID()
	}
	if !idPattern.MatchString(r.ID) {
		return Entry{}, ErrInvalid
	}
	conflict, e := hasConflict(root, r.ID)
	if e != nil {
		return Entry{}, e
	}
	if conflict {
		return Entry{}, ErrConflict
	}
	if !idPattern.MatchString(r.ID) {
		return Entry{}, ErrInvalid
	}
	current, e := s.get(root, r.ID)
	actual := "missing"
	if e == nil {
		actual = current.Revision
	} else if !errors.Is(e, os.ErrNotExist) {
		return Entry{}, e
	}
	if expected != actual {
		return Entry{}, ErrConflict
	}
	r.Authorizations = nil
	r.Operations = nil
	if actual != "missing" {
		r.Created = current.Record.Created
		r.Authorizations = append(r.Authorizations, current.Record.Authorizations...)
		r.Operations = append(r.Operations, current.Record.Operations...)
	}
	if explicit && actual == "missing" {
		for _, w := range ws {
			if w.Target == r.ID {
				return Entry{}, ErrWithdrawn
			}
			for _, a := range w.Sources {
				for _, b := range r.Sources {
					if a.Kind == b.Kind && a.ID == b.ID && !contains(r.Authorizations, withdrawalAuthorization(w)) {
						r.Authorizations = append(r.Authorizations, withdrawalAuthorization(w))
					}
				}
			}
		}
	}
	if withdrawn(r, ws) {
		return Entry{}, ErrWithdrawn
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	r.Schema = 1
	r.Updated = now
	if actual != "missing" && AutomaticCandidate(current.Record) && AutomaticCandidate(r) &&
		candidateKey(current.Record) == candidateKey(r) && current.Record.Reason == r.Reason {
		r.Updated = current.Record.Updated
	}
	if actual == "missing" {
		r.Created = now
	}
	r.Operations = append(r.Operations, op)
	if e = validateRecord(r); e != nil {
		return Entry{}, e
	}
	data, e := encode(r, r.Content)
	if e != nil {
		return Entry{}, e
	}
	if e = checkContext(ctx); e != nil {
		return Entry{}, e
	}
	latest, readErr := s.get(root, r.ID)
	latestRevision := "missing"
	if readErr == nil {
		latestRevision = latest.Revision
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return Entry{}, readErr
	}
	if latestRevision != expected {
		return Entry{}, ErrConflict
	}
	if guard != nil {
		if e = guard(); e != nil {
			return Entry{}, e
		}
	}
	for _, reference := range references {
		current, err := s.get(root, reference.Record.ID)
		if err != nil || current.Revision != reference.Revision || withdrawn(current.Record, ws) {
			return Entry{}, ErrConflict
		}
		conflicted, err := hasConflict(root, reference.Record.ID)
		if err != nil || conflicted {
			return Entry{}, ErrConflict
		}
	}
	if e = checkContext(ctx); e != nil {
		return Entry{}, e
	}
	if e = writeFile(rr, r.ID+".md", data); e != nil {
		return Entry{}, e
	}
	return Entry{r, revision(data)}, nil
}
func (s *Store) Forget(ctx context.Context, id, expected, op string) (ForgetResult, error) {
	return s.GuardedForget(ctx, id, expected, op, nil)
}

// GuardedForget 在撤回写入锁内复核调用方权限与来源，复用持久撤回和 CAS 保护。
func (s *Store) GuardedForget(ctx context.Context, id, expected, op string, guard func() error) (ForgetResult, error) {
	return s.forget(ctx, id, expected, op, guard, false)
}

// GuardedDiscardCandidate 只清理自动候选，按记录身份抑制恢复，不撤回其笔记或会话来源。
func (s *Store) GuardedDiscardCandidate(ctx context.Context, id, expected, op string, guard func() error) (ForgetResult, error) {
	return s.forget(ctx, id, expected, op, guard, true)
}

func (s *Store) forget(ctx context.Context, id, expected, op string, guard func() error, candidateOnly bool) (ForgetResult, error) {
	ret := ForgetResult{ID: id}
	if !idPattern.MatchString(id) || op == "" || len(op) > 256 {
		return ret, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := checkContext(ctx); e != nil {
		return ret, e
	}
	if guard != nil {
		if e := guard(); e != nil {
			return ret, e
		}
	}
	root, e := s.root(true)
	if e != nil {
		return ret, e
	}
	defer root.Close()
	ws, e := s.withdrawals(ctx, root)
	if e != nil {
		return ret, e
	}
	for _, w := range ws {
		if w.Target == id {
			ret.WithdrawalID = w.ID
			return s.cleanup(root, ret)
		}
	}
	entry, e := s.get(root, id)
	if e != nil {
		return ret, e
	}
	if guard != nil || candidateOnly {
		conflicted, conflictErr := hasConflict(root, id)
		if conflictErr != nil {
			return ret, conflictErr
		}
		if conflicted {
			return ret, ErrConflict
		}
	}
	if entry.Revision != expected {
		return ret, ErrConflict
	}
	if candidateOnly && !AutomaticCandidate(entry.Record) {
		return ret, ErrConflict
	}
	if e = checkContext(ctx); e != nil {
		return ret, e
	}
	w := withdrawal{Schema: 1, ID: NewID(), Target: id, Operation: op, Created: time.Now().UTC().Format(time.RFC3339Nano)}
	for _, operation := range entry.Record.Operations {
		hash := revision([]byte(operation))
		if !contains(w.OperationHashes, hash) {
			w.OperationHashes = append(w.OperationHashes, hash)
		}
	}
	for _, source := range entry.Record.Sources {
		source.Evidence = ""
		w.Sources = append(w.Sources, source)
	}
	if candidateOnly {
		w.Sources = []Source{{Kind: "record", ID: id, Revision: expected}}
	}
	rr, e := subroot(root, "records", false)
	if e != nil {
		return ret, e
	}
	defer rr.Close()
	targetFact := withdrawalFact(entry.Record)
	e = eachFile(ctx, rr, func(name string, data []byte) error {
		other, err := DecodeRecord(data, strings.TrimSuffix(name, ".md"))
		if err != nil {
			return err
		}
		r := other.Record
		if r.ID == id || withdrawn(r, ws) || withdrawalFact(r) == targetFact {
			return nil
		}
		for _, a := range w.Sources {
			for _, b := range r.Sources {
				if a.Kind == b.Kind && a.ID == b.ID {
					w.Survivors = append(w.Survivors, withdrawalSurvivor{ID: r.ID, Fact: withdrawalFact(r)})
					return nil
				}
			}
		}
		return nil
	})
	if e != nil {
		return ret, e
	}
	if len(w.Survivors) > 0 {
		w.Schema = 2
	}
	slices.SortFunc(w.Survivors, func(a, b withdrawalSurvivor) int { return strings.Compare(a.ID, b.ID) })
	data, e := encode(w, "")
	if e != nil {
		return ret, e
	}
	wr, e := subroot(root, "withdrawals", true)
	if e != nil {
		return ret, e
	}
	defer wr.Close()
	if e = checkContext(ctx); e != nil {
		return ret, e
	}
	if guard != nil {
		if e = guard(); e != nil {
			return ret, e
		}
		current, readErr := s.get(root, id)
		if readErr != nil || current.Revision != expected {
			return ret, ErrConflict
		}
		conflicted, conflictErr := hasConflict(root, id)
		if conflictErr != nil {
			return ret, conflictErr
		}
		if conflicted {
			return ret, ErrConflict
		}
	}
	if e = checkContext(ctx); e != nil {
		return ret, e
	}
	if e = writeFile(wr, w.ID+".md", data); e != nil {
		return ret, e
	}
	ret.WithdrawalID = w.ID
	return s.cleanup(root, ret)
}
func (s *Store) cleanup(root *os.Root, ret ForgetResult) (ForgetResult, error) {
	rr, e := subroot(root, "records", false)
	if errors.Is(e, os.ErrNotExist) {
		return ret, nil
	}
	if e != nil {
		ret.CleanupPending = true
		return ret, e
	}
	defer rr.Close()
	e = rr.Remove(ret.ID + ".md")
	if e != nil && !errors.Is(e, os.ErrNotExist) {
		ret.CleanupPending = true
		return ret, e
	}
	return ret, nil
}

// 撤回授权以稳定操作和目标标识计算，快照保护复制改变文件 ID 不改变授权关系。
func withdrawalAuthorization(w withdrawal) string {
	w.ID = ""
	data, _ := json.Marshal(w)
	return revision(data)
}
