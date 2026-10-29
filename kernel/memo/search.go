// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
)

func (s *Store) Search(ctx context.Context, options SearchOptions) (SearchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(false)
	if errors.Is(e, os.ErrNotExist) {
		return SearchResult{Entries: []Entry{}, Errors: []string{}}, nil
	}
	if e != nil {
		return SearchResult{}, e
	}
	defer root.Close()
	return s.search(ctx, root, options)
}
func (s *Store) search(ctx context.Context, root *os.Root, options SearchOptions) (SearchResult, error) {
	ret := SearchResult{Entries: []Entry{}, Errors: []string{}}
	ws, e := s.withdrawals(ctx, root)
	if e != nil {
		return ret, e
	}
	rr, e := subroot(root, "records", false)
	if errors.Is(e, os.ErrNotExist) {
		return ret, nil
	}
	if e != nil {
		return ret, e
	}
	defer rr.Close()
	limit := options.Limit
	if limit <= 0 || limit > MaxResults {
		limit = MaxResults
	}
	offset := options.Offset
	if offset < 0 {
		return ret, ErrInvalid
	}
	d, e := rr.Open(".")
	if e != nil {
		return ret, e
	}
	defer d.Close()
	matched := 0
	items, e := d.ReadDir(-1)
	if e != nil {
		return ret, e
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name() < items[j].Name() })
	{
		for _, item := range items {
			if err := checkContext(ctx); err != nil {
				ret.Incomplete = true
				return ret, err
			}
			name := item.Name()
			if strings.HasPrefix(name, ".pending-") {
				continue
			}
			id := strings.TrimSuffix(name, ".md")
			if !strings.HasSuffix(name, ".md") || !idPattern.MatchString(id) {
				ret.Errors = append(ret.Errors, "invalid memory file name")
				ret.Incomplete = true
				continue
			}
			data, err := readFile(rr, name)
			if err != nil {
				ret.Errors = append(ret.Errors, fmt.Sprintf("%s: unreadable memory", id))
				ret.Incomplete = true
				continue
			}
			entry, err := DecodeRecord(data, id)
			if err != nil {
				ret.Errors = append(ret.Errors, fmt.Sprintf("%s: invalid memory", id))
				ret.Incomplete = true
				continue
			}
			conflict, err := hasConflict(root, id)
			if err != nil {
				return ret, err
			}
			r := entry.Record
			if conflict || withdrawn(r, ws) {
				continue
			}
			if len(options.States) == 0 {
				if !Usable(r) {
					continue
				}
			} else if !contains(options.States, r.State) {
				continue
			}
			if r.State == "active" && !options.IncludeInactiveValidity && !Usable(r) {
				continue
			}
			if len(options.Scopes) > 0 && !contains(options.Scopes, r.Scope) {
				continue
			}
			text := strings.ToLower(r.Content + " " + r.Subject + " " + r.Kind + " " + r.Scope)
			hit := len(options.Terms) == 0
			for _, term := range options.Terms {
				if strings.TrimSpace(term) != "" && strings.Contains(text, strings.ToLower(term)) {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
			matched++
			if matched <= offset {
				continue
			}
			if len(ret.Entries) == limit {
				ret.Incomplete = true
				continue
			}
			ret.Entries = append(ret.Entries, entry)
		}
		return ret, nil
	}
}
func (s *Store) Snapshot(ctx context.Context, scopes []string) (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, e := s.root(false)
	if e != nil {
		return Snapshot{}, e
	}
	defer root.Close()
	return s.snapshot(ctx, root, scopes)
}

// snapshot 对完整有效集合计算指纹，仅保留模型预算内的正文选择；分页扫描不常驻全部正文。
func (s *Store) snapshot(ctx context.Context, root *os.Root, scopes []string) (Snapshot, error) {
	ret := Snapshot{Entries: []Entry{}}
	hasher := sha256.New()
	for offset := 0; ; {
		result, err := s.search(ctx, root, SearchOptions{Scopes: scopes, Limit: MaxResults, Offset: offset})
		if err != nil {
			return Snapshot{}, err
		}
		if len(result.Errors) > 0 {
			return Snapshot{}, ErrIncomplete
		}
		for _, entry := range result.Entries {
			r := entry.Record
			r.Created = ""
			r.Updated = ""
			r.Confirmed = ""
			r.Operations = nil
			r.Reason = ""
			data, err := json.Marshal(r)
			if err != nil {
				return Snapshot{}, err
			}
			hasher.Write([]byte(revision(data)))
			hasher.Write([]byte("\n"))
			ret.RecordCount++
			if len(ret.Entries) < MaxResults {
				ret.Entries = append(ret.Entries, entry)
			}
		}
		if !result.Incomplete {
			break
		}
		if len(result.Entries) == 0 {
			return Snapshot{}, ErrIncomplete
		}
		offset += len(result.Entries)
	}
	ret.Fingerprint = hex.EncodeToString(hasher.Sum(nil))
	ret.Partial = ret.RecordCount > len(ret.Entries)
	return ret, nil
}
