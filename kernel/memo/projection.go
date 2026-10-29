package memo

import (
	"context"
	"errors"
	"os"
	"time"
)

type projectionHeader struct {
	Schema      int    `yaml:"schema"`
	Fingerprint string `yaml:"fingerprint"`
}

func projectionName(name string) bool { return name == "USER.md" || name == "MEMORY.md" }
func (s *Store) SaveProjection(ctx context.Context, name, content, fingerprint string, scopes []string) error {
	if !projectionName(name) {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(true)
	if e != nil {
		return e
	}
	defer root.Close()
	snapshot, e := s.snapshot(ctx, root, scopes)
	if e != nil {
		return e
	}
	if snapshot.Fingerprint != fingerprint {
		return ErrConflict
	}
	data, e := encode(projectionHeader{1, fingerprint}, content)
	if e != nil {
		return e
	}
	if e = checkContext(ctx); e != nil {
		return e
	}
	return writeFile(root, name, data)
}
func (s *Store) ReadProjection(ctx context.Context, name string, scopes []string) (Projection, error) {
	if !projectionName(name) {
		return Projection{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(false)
	if e != nil {
		return Projection{}, e
	}
	defer root.Close()
	data, e := readFile(root, name)
	if e != nil {
		return Projection{}, e
	}
	var header projectionHeader
	body, e := decode(data, &header)
	if e != nil || header.Schema != 1 {
		return Projection{}, ErrInvalid
	}
	snapshot, e := s.snapshot(ctx, root, scopes)
	if e != nil {
		return Projection{}, e
	}
	if header.Fingerprint != snapshot.Fingerprint {
		return Projection{}, ErrConflict
	}
	return Projection{body, header.Fingerprint}, nil
}
func hasConflict(root *os.Root, id string) (bool, error) {
	cr, e := subroot(root, "conflicts", false)
	if errors.Is(e, os.ErrNotExist) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	defer cr.Close()
	_, e = cr.Lstat(id)
	if errors.Is(e, os.ErrNotExist) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	return true, nil
}
func (s *Store) HasConflict(ctx context.Context, id string) (bool, error) {
	if !idPattern.MatchString(id) {
		return false, ErrInvalid
	}
	if e := checkContext(ctx); e != nil {
		return false, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(false)
	if errors.Is(e, os.ErrNotExist) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	defer root.Close()
	return hasConflict(root, id)
}

// Quarantine 先建立排除标记，再保存原始冲突版本；中断时仍然拒绝采用冲突记录。
func (s *Store) Quarantine(ctx context.Context, id string, versions [][]byte) error {
	if !idPattern.MatchString(id) {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(true)
	if e != nil {
		return e
	}
	defer root.Close()
	cr, e := subroot(root, "conflicts", true)
	if e != nil {
		return e
	}
	defer cr.Close()
	ir, e := subroot(cr, id, true)
	if e != nil {
		return e
	}
	defer ir.Close()
	for _, data := range versions {
		if e = checkContext(ctx); e != nil {
			return e
		}
		if len(data) > MaxFileSize {
			return ErrInvalid
		}
		if e = writeFile(ir, revision(data)+".md", data); e != nil {
			return e
		}
	}
	return nil
}
func ValidateWithdrawal(data []byte, id string) error {
	var w withdrawal
	body, e := decode(data, &w)
	if e != nil {
		return e
	}
	if body != "" || w.Schema != 1 || w.ID != id || !idPattern.MatchString(w.ID) || !idPattern.MatchString(w.Target) || w.Operation == "" || w.Created == "" {
		return ErrInvalid
	}
	if _, err := time.Parse(time.RFC3339Nano, w.Created); err != nil {
		return ErrInvalid
	}
	if len(w.Sources) == 0 {
		return ErrInvalid
	}
	for _, source := range w.Sources {
		if source.ID == "" || source.Kind == "" || source.Evidence != "" {
			return ErrInvalid
		}
	}
	return nil
}

// PreserveWithdrawal 在恢复计划之外保存等价撤回标记，防止历史快照恢复已忘记内容。
func (s *Store) PreserveWithdrawal(ctx context.Context, data []byte, id string) (string, error) {
	if e := ValidateWithdrawal(data, id); e != nil {
		return "", e
	}
	var w withdrawal
	if _, e := decode(data, &w); e != nil {
		return "", e
	}
	w.ID = NewID()
	encoded, e := encode(w, "")
	if e != nil {
		return "", e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e = checkContext(ctx); e != nil {
		return "", e
	}
	root, e := s.root(true)
	if e != nil {
		return "", e
	}
	defer root.Close()
	wr, e := subroot(root, "withdrawals", true)
	if e != nil {
		return "", e
	}
	defer wr.Close()
	if e = writeFile(wr, w.ID+".md", encoded); e != nil {
		return "", e
	}
	return w.ID, nil
}
