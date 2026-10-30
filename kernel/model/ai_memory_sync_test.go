// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/memo"
)

func TestAIMemorySyncCausalHistory(t *testing.T) {
	for _, test := range []struct {
		previous, next []string
		want           bool
	}{
		{[]string{"a"}, []string{"a", "b"}, true},
		{[]string{"a", "b"}, []string{"a"}, false},
		{[]string{"a"}, []string{"b"}, false},
		{[]string{"a"}, []string{"a"}, false},
		{[]string{"a"}, []string{"a", "a"}, false},
		{nil, []string{"a"}, false},
	} {
		if got := memoryOperationsExtend(test.previous, test.next); got != test.want {
			t.Fatalf("causality: got %v want %v", got, test.want)
		}
	}
}

func TestAIMemorySyncPreservesProjectionBeforeRemoval(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "storage/ai/memos")
	if err := os.MkdirAll(base, 0700); err != nil {
		t.Fatal(err)
	}
	original := []byte("legacy overview with unique content")
	if err := os.WriteFile(filepath.Join(base, "USER.md"), original, 0600); err != nil {
		t.Fatal(err)
	}
	plan := &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: memorySyncPrefix + "USER.md"}}}
	if err := memoryCheckoutPreflight(dir, plan); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(filepath.Join(base, "legacy-projections"))
	if err != nil || len(files) != 1 {
		t.Fatalf("backup: %v %v", files, err)
	}
	data, err := os.ReadFile(filepath.Join(base, "legacy-projections", files[0].Name()))
	if err != nil || string(data) != string(original) {
		t.Fatalf("original not preserved: %q %v", data, err)
	}
	plan.Removes = []*entity.File{{Path: memorySyncPrefix + "legacy-projections/" + files[0].Name()}}
	if err = memoryCheckoutPreflight(dir, plan); err == nil {
		t.Fatal("migration backup can be silently deleted by sync")
	}
}
func memorySyncTestRecord() memo.Record {
	return memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: "concise answers", Sources: []memo.Source{{Kind: "manual", ID: "test", Revision: "v1"}}}
}

func TestAIMemorySyncWithdrawalSurvivesPlan(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	store := memo.NewStore(dir)
	entry, err := store.Save(ctx, memorySyncTestRecord(), "missing", "remember")
	if err != nil {
		t.Fatal(err)
	}
	forgotten, err := store.Forget(ctx, entry.Record.ID, entry.Revision, "forget")
	if err != nil {
		t.Fatal(err)
	}
	name := memorySyncPrefix + "withdrawals/" + forgotten.WithdrawalID + ".md"
	plan := &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: name}}}
	if err = memoryCheckoutPreflight(dir, plan); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(dir, filepath.FromSlash(name))); err != nil {
		t.Fatal(err)
	}
	// 恢复旧记录必须仍被新保存的撤回引用拦截。
	if _, err = store.Save(ctx, entry.Record, "missing", "old-retry"); !errors.Is(err, memo.ErrWithdrawn) {
		t.Fatalf("old memory revived: %v", err)
	}
	files, err := os.ReadDir(filepath.Join(dir, "storage/ai/memos/withdrawals"))
	if err != nil || len(files) != 1 {
		t.Fatalf("retained marker: %d %v", len(files), err)
	}
}

func TestAIMemorySyncRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "storage")); err != nil {
		t.Skip(err)
	}
	_, err := memorySyncRead(dir, "/storage/ai/memos/records/20261029000000-abcdefg.md")
	if !errors.Is(err, memo.ErrInvalid) {
		t.Fatalf("symlink accepted: %v", err)
	}
}

func TestAIMemorySyncCheckoutRestoresWithoutRevival(t *testing.T) {
	ctx := context.Background()
	repo := newCheckoutSourceTestRepo(t)
	if err := os.MkdirAll(repo.DataPath, 0700); err != nil {
		t.Fatal(err)
	}
	store := memo.NewStore(repo.DataPath)
	entry, err := store.Save(ctx, memorySyncTestRecord(), "missing", "remember")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := repo.IndexWithOptions("memory before forgetting", false, nil, dejavu.IndexOptions{FullCheck: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Forget(ctx, entry.Record.ID, entry.Revision, "forget"); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.IndexWithOptions("memory after forgetting", false, nil, dejavu.IndexOptions{FullCheck: true}); err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.Checkout(snapshot.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get(ctx, entry.Record.ID); !errors.Is(err, memo.ErrWithdrawn) {
		t.Fatalf("restored forgotten content usable: %v", err)
	}
}

func TestAIMemorySyncCheckoutDivergenceQuarantines(t *testing.T) {
	ctx := context.Background()
	repo := newCheckoutSourceTestRepo(t)
	if err := os.MkdirAll(repo.DataPath, 0700); err != nil {
		t.Fatal(err)
	}
	store := memo.NewStore(repo.DataPath)
	entry, err := store.Save(ctx, memorySyncTestRecord(), "missing", "remember")
	if err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(repo.DataPath, "storage/ai/memos/records", entry.Record.ID+".md")
	original, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	record := entry.Record
	record.Content = "remote changed preference"
	_, err = store.Save(ctx, record, entry.Revision, "remote-edit")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := repo.IndexWithOptions("remote memory", false, nil, dejavu.IndexOptions{FullCheck: true})
	if err != nil {
		t.Fatal(err)
	}
	// 构建另一设备从共同祖先作出的不同修改。
	if err = os.WriteFile(filename, original, 0600); err != nil {
		t.Fatal(err)
	}
	record = entry.Record
	record.Content = "local changed preference"
	if _, err = store.Save(ctx, record, entry.Revision, "local-edit"); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.IndexWithOptions("local memory", false, nil, dejavu.IndexOptions{FullCheck: true}); err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.Checkout(snapshot.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get(ctx, entry.Record.ID); !errors.Is(err, memo.ErrConflict) {
		t.Fatalf("divergence activated: %v", err)
	}
	archived, err := os.ReadDir(filepath.Join(repo.DataPath, "storage/ai/memos/conflicts", entry.Record.ID))
	if err != nil || len(archived) < 2 {
		t.Fatalf("both versions not preserved: %d %v", len(archived), err)
	}
}

func TestAIMemorySyncProtectsSafetyMetadata(t *testing.T) {
	for _, relative := range []string{"operations/operation-hash.md", "conflicts/20261029000000-abcdefg/version.md"} {
		t.Run(relative, func(t *testing.T) {
			dir := t.TempDir()
			name := memorySyncPrefix + relative
			target := filepath.Join(dir, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, []byte("retained evidence"), 0600); err != nil {
				t.Fatal(err)
			}
			plan := &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: name}}}
			if err := memoryCheckoutPreflight(dir, plan); err == nil {
				t.Fatal("safety metadata deletion allowed")
			}
			data, err := os.ReadFile(target)
			if err != nil || string(data) != "retained evidence" {
				t.Fatalf("metadata changed: %s %v", data, err)
			}
		})
	}
}
