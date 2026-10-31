// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestClearMemoryWithdrawsEveryStateAndCurrentProjections(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	var entries []Entry
	for _, state := range []string{"candidate", "active", "review", "disabled", "superseded"} {
		r := sample()
		r.State = state
		entry, err := s.Save(ctx, r, "missing", state)
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, entry)
	}
	for _, name := range []string{"MEMORY.md", "USER.md"} {
		if err := os.WriteFile(filepath.Join(s.dataDir, "storage/ai/memos", name), []byte("Old summary"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Clear(ctx, nil); err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		raw, err := encode(entry.Record, entry.Record.Content)
		if err != nil {
			t.Fatal(err)
		}
		name := filepath.Join(s.dataDir, "storage/ai/memos/records", entry.Record.ID+".md")
		if err = os.WriteFile(name, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = s.Get(ctx, entry.Record.ID); !errors.Is(err, ErrWithdrawn) {
			t.Fatalf("restored %s is usable: %v", entry.Record.State, err)
		}
		if _, err = s.Save(ctx, sample(), "missing", entry.Record.Operations[0]); !errors.Is(err, ErrWithdrawn) {
			t.Fatalf("old operation replayed: %v", err)
		}
	}
	if err := s.Clear(ctx, nil); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"MEMORY.md", "USER.md"} {
		if _, err := os.Stat(filepath.Join(s.dataDir, "storage/ai/memos", name)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("projection retained: %s %v", name, err)
		}
	}
}

func TestClearMemoryPreservesUnsupportedRecordsBeforeAnyWithdrawal(t *testing.T) {
	s := newTestStore(t)
	entry := saveSample(t, s, "original")
	name := filepath.Join(s.dataDir, "storage/ai/memos/records", NewID()+".md")
	raw := []byte("unknown format")
	if err := os.WriteFile(name, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear(context.Background(), nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsupported data ignored: %v", err)
	}
	current, err := s.Get(context.Background(), entry.Record.ID)
	if err != nil || current.Revision != entry.Revision {
		t.Fatalf("validation failure partially withdrew data: %v", err)
	}
	data, err := os.ReadFile(name)
	if err != nil || string(data) != string(raw) {
		t.Fatal("unsupported original changed")
	}
}
