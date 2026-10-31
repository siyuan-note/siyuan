// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"
)

// Clear 撤回全部正式记录并清理当前概览；防恢复标记和历史保护副本继续保留。
// 调用方须先关闭自动维护并阻止旧请求写入；所有记录先校验，再开始撤回。
func (s *Store) Clear(ctx context.Context, guard func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	check := func() error {
		if err := checkContext(ctx); err != nil {
			return err
		}
		if guard != nil {
			return guard()
		}
		return nil
	}
	if err := check(); err != nil {
		return err
	}
	root, err := s.root(false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	ws, err := s.withdrawals(ctx, root)
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, w := range ws {
		known[w.Target] = true
	}
	type deletion struct {
		id   string
		data []byte
	}
	var plan []deletion
	rr, err := subroot(root, "records", false)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		defer rr.Close()
		err = eachFile(ctx, rr, func(name string, data []byte) error {
			if err := check(); err != nil {
				return err
			}
			entry, err := DecodeRecord(data, strings.TrimSuffix(name, ".md"))
			if err != nil {
				return err
			}
			item := deletion{id: entry.Record.ID}
			if !known[item.id] {
				w := withdrawal{Schema: 1, ID: NewID(), Target: item.id, Operation: "clear:" + NewID(), Created: time.Now().UTC().Format(time.RFC3339Nano)}
				for _, source := range entry.Record.Sources {
					source.Evidence = ""
					w.Sources = append(w.Sources, source)
				}
				for _, op := range entry.Record.Operations {
					hash := revision([]byte(op))
					if !contains(w.OperationHashes, hash) {
						w.OperationHashes = append(w.OperationHashes, hash)
					}
				}
				item.data, err = encode(w, "")
				if err != nil {
					return err
				}
			}
			plan = append(plan, item)
			return nil
		})
		if err != nil {
			return err
		}
	}
	if len(plan) > 0 {
		wr, err := subroot(root, "withdrawals", true)
		if err != nil {
			return err
		}
		defer wr.Close()
		for _, item := range plan {
			if err = check(); err != nil {
				return err
			}
			if len(item.data) > 0 {
				var w withdrawal
				if _, err = decode(item.data, &w); err != nil {
					return err
				}
				if err = writeFile(wr, w.ID+".md", item.data); err != nil {
					return err
				}
			}
		}
		for _, item := range plan {
			if err = check(); err != nil {
				return err
			}
			if err = rr.Remove(item.id + ".md"); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	for _, name := range []string{"MEMORY.md", "USER.md"} {
		if err = check(); err != nil {
			return err
		}
		if _, err = readFile(root, name); errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if err = root.Remove(name); err != nil {
			return err
		}
	}
	return nil
}
