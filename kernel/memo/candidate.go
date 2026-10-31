// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
	"time"
)

// AutomaticCandidate 排除手动来源和明确确认过的内容，未知来源按需人工处理。
func AutomaticCandidate(r Record) bool {
	if r.State != "candidate" || r.Confirmed != "" || len(r.Sources) == 0 {
		return false
	}
	for _, source := range r.Sources {
		if source.Kind != "block" && source.Kind != "conversation" {
			return false
		}
	}
	return true
}

// Visit 返回逐文件读取的快照；回调写入必须使用修订检查，不能假定扫描期间没有其他写入。
func (s *Store) Visit(ctx context.Context, visit func(Entry) error) error {
	root, err := s.root(false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	rr, err := subroot(root, "records", false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer rr.Close()
	return eachFile(ctx, rr, func(name string, data []byte) error {
		entry, err := DecodeRecord(data, strings.TrimSuffix(name, ".md"))
		if err != nil {
			return err
		}
		return visit(entry)
	})
}

func candidateKey(r Record) string {
	sources := append([]Source{}, r.Sources...)
	slices.SortFunc(sources, func(a, b Source) int {
		aa, _ := json.Marshal(a)
		bb, _ := json.Marshal(b)
		return strings.Compare(string(aa), string(bb))
	})
	data, _ := json.Marshal(struct {
		Fact                    string
		From, Until, Supersedes string
		Sources                 []Source
	}{withdrawalFact(r), r.ValidFrom, r.ValidUntil, r.Supersedes, sources})
	return revision(data)
}

// MaintainCandidates 清理长期未更新的自动候选，并合并事实和完整来源均相同的重复记录。
// 不以出现次数自动确认事实；清理标记不保留正文，也不禁止原来源产生新的候选。
func (s *Store) MaintainCandidates(ctx context.Context, before time.Time, guard func() error) (int, error) {
	type identity struct{ id, revision string }
	seen := map[string]identity{}
	removed := 0
	err := s.Visit(ctx, func(snapshot Entry) error {
		if guard != nil {
			if err := guard(); err != nil {
				return err
			}
		}
		if !AutomaticCandidate(snapshot.Record) {
			return nil
		}
		entry, err := s.Get(ctx, snapshot.Record.ID)
		if errors.Is(err, ErrWithdrawn) {
			updated, parseErr := time.Parse(time.RFC3339Nano, snapshot.Record.Updated)
			if parseErr != nil {
				return parseErr
			}
			if updated.After(before) {
				return nil
			}
			entry, err = snapshot, nil
		}
		if errors.Is(err, ErrWithdrawn) || errors.Is(err, ErrConflict) || errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if entry.Revision != snapshot.Revision {
			return nil
		}
		updated, err := time.Parse(time.RFC3339Nano, entry.Record.Updated)
		if err != nil {
			return err
		}
		key := candidateKey(entry.Record)
		duplicate := false
		if other, ok := seen[key]; ok {
			current, readErr := s.Get(ctx, other.id)
			duplicate = readErr == nil && current.Revision == other.revision
		}
		if updated.After(before) && !duplicate {
			seen[key] = identity{entry.Record.ID, entry.Revision}
			return nil
		}
		result, err := s.GuardedDiscardCandidate(ctx, entry.Record.ID, entry.Revision, "candidate-cleanup:"+entry.Record.ID+":"+entry.Revision, guard)
		if errors.Is(err, ErrConflict) {
			return nil
		}
		if result.WithdrawalID != "" {
			removed++
		}
		return err
	})
	return removed, err
}
