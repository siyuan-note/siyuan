// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"time"
)

type projectionHeader struct {
	Schema      int    `yaml:"schema"`
	Fingerprint string `yaml:"fingerprint"`
}

func projectionName(name string) bool { return name == "USER.md" || name == "MEMORY.md" }

// 迁移备份按原始内容寻址，只用于恢复，不参与概览读取或模型上下文。
func preserveProjection(root *os.Root, name string, data []byte) error {
	if !projectionName(name) || len(data) > MaxFileSize {
		return ErrInvalid
	}
	backup, err := subroot(root, "legacy-projections", true)
	if err != nil {
		return err
	}
	defer backup.Close()
	file := strings.TrimSuffix(name, ".md") + "-" + revision(data) + ".md"
	previous, err := readFile(backup, file)
	if err == nil {
		if !bytes.Equal(previous, data) {
			return ErrConflict
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return writeFile(backup, file, data)
}

func (s *Store) PreserveProjection(ctx context.Context, name string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := checkContext(ctx); err != nil {
		return err
	}
	root, err := s.root(true)
	if err != nil {
		return err
	}
	defer root.Close()
	return preserveProjection(root, name, data)
}

// MigrateProjection 先保存旧文件原文，再原子写入统一概览，最后移除旧入口。
// 指纹不匹配的原文只保存在备份中，绝不能据此恢复已撤回或失效的记忆。
func (s *Store) MigrateProjection(ctx context.Context, scopes []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := checkContext(ctx); err != nil {
		return err
	}
	root, err := s.root(false)
	if err != nil {
		return err
	}
	defer root.Close()
	snapshot, err := s.snapshot(ctx, root, scopes)
	if err != nil {
		return err
	}
	var parts []string
	var unified bool
	var userExists bool
	for _, name := range []string{"USER.md", "MEMORY.md"} {
		data, readErr := readFile(root, name)
		if errors.Is(readErr, os.ErrNotExist) {
			continue
		}
		if readErr != nil {
			return readErr
		}
		if name == "USER.md" {
			userExists = true
		}
		var header projectionHeader
		body, decodeErr := decode(data, &header)
		if name == "MEMORY.md" && decodeErr == nil && header.Schema == 2 {
			unified = true
			continue
		}
		if err = preserveProjection(root, name, data); err != nil {
			return err
		}
		if decodeErr != nil || header.Schema != 1 {
			return ErrInvalid
		}
		if header.Fingerprint == snapshot.Fingerprint {
			parts = append(parts, body)
		}
	}
	if err = checkContext(ctx); err != nil {
		return err
	}
	if !unified {
		if len(parts) == 0 {
			return ErrConflict
		}
		data, encodeErr := encode(projectionHeader{2, snapshot.Fingerprint}, strings.Join(parts, "\n\n"))
		if encodeErr != nil {
			return encodeErr
		}
		if len(data) > MaxFileSize {
			return ErrInvalid
		}
		if err = writeFile(root, "MEMORY.md", data); err != nil {
			return err
		}
	}
	if userExists {
		return root.Remove("USER.md")
	}
	return nil
}
func (s *Store) SaveProjection(ctx context.Context, name, content, fingerprint string, scopes []string) error {
	if name != "MEMORY.md" {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := checkContext(ctx); err != nil {
		return err
	}
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
	// 写入失败或不支持的旧格式不能被静默覆盖。
	for _, oldName := range []string{"USER.md", "MEMORY.md"} {
		previous, readErr := readFile(root, oldName)
		if errors.Is(readErr, os.ErrNotExist) {
			continue
		}
		if readErr != nil {
			return readErr
		}
		var header projectionHeader
		_, decodeErr := decode(previous, &header)
		if decodeErr != nil || (header.Schema != 1 && !(oldName == "MEMORY.md" && header.Schema == 2)) {
			return ErrInvalid
		}
		if header.Schema == 1 {
			if e = preserveProjection(root, oldName, previous); e != nil {
				return e
			}
		}
	}
	data, e := encode(projectionHeader{2, fingerprint}, content)
	if e != nil {
		return e
	}
	if e = checkContext(ctx); e != nil {
		return e
	}
	if len(data) > MaxFileSize {
		return ErrInvalid
	}
	if e = writeFile(root, name, data); e != nil {
		return e
	}
	if e = root.Remove("USER.md"); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	return nil
}
func (s *Store) ReadProjection(ctx context.Context, name string, scopes []string) (Projection, error) {
	if name != "MEMORY.md" {
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
	if e != nil || header.Schema != 2 {
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
	seen := map[string]bool{}
	for _, hash := range w.OperationHashes {
		if !validHash(hash) || seen[hash] {
			return ErrInvalid
		}
		seen[hash] = true
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
