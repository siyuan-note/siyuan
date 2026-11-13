// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/memory"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func memorySyncTestRecord() memory.Record {
	return memory.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: "concise answers", Sources: []memory.Source{{Kind: "manual", ID: "test", Revision: "v1"}}}
}

func memoryCheckoutTestRepo(t *testing.T, sync bool) *dejavu.Repo {
	t.Helper()
	repo := newCheckoutSourceTestRepo(t)
	if err := os.MkdirAll(repo.DataPath, 0700); err != nil {
		t.Fatal(err)
	}
	if sync {
		repo.SetCheckoutHooks(dejavu.CheckoutHooks{Preflight: syncDocumentPreflight(repo)})
	}
	return repo
}

func memoryCheckoutTestIndex(t *testing.T, repo *dejavu.Repo) string {
	t.Helper()
	index, err := repo.IndexWithOptions("memory checkout test", false, nil, dejavu.IndexOptions{FullCheck: true})
	if err != nil {
		t.Fatal(err)
	}
	return index.ID
}

func memoryCheckoutTestRestore(t *testing.T, repo *dejavu.Repo, id string) {
	t.Helper()
	if _, _, err := repo.Checkout(id, nil); err != nil {
		t.Fatal(err)
	}
}

func TestAIMemoryCheckoutRestoresWithdrawalState(t *testing.T) {
	for _, sync := range []bool{false, true} {
		t.Run(map[bool]string{false: "snapshot", true: "sync-preflight"}[sync], func(t *testing.T) {
			ctx := context.Background()
			repo := memoryCheckoutTestRepo(t, sync)
			store := memory.NewStore(repo.DataPath)
			entry, err := store.Save(ctx, memorySyncTestRecord(), "missing", "remember")
			if err != nil {
				t.Fatal(err)
			}
			before := memoryCheckoutTestIndex(t, repo)
			if _, err = store.Forget(ctx, entry.Record.ID, entry.Revision, "forget"); err != nil {
				t.Fatal(err)
			}
			after := memoryCheckoutTestIndex(t, repo)
			memoryCheckoutTestRestore(t, repo, before)
			restored, err := store.Get(ctx, entry.Record.ID)
			if err != nil || restored.Revision != entry.Revision {
				t.Fatalf("snapshot memory not restored: %+v %v", restored, err)
			}
			files, err := os.ReadDir(filepath.Join(repo.DataPath, "storage/ai/memory/withdrawals"))
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				t.Fatal(err)
			}
			if len(files) != 0 {
				t.Fatalf("extra withdrawals retained: %v", files)
			}
			memoryCheckoutTestRestore(t, repo, after)
			if _, err = store.Save(ctx, entry.Record, "missing", "old-retry"); !errors.Is(err, memory.ErrWithdrawn) {
				t.Fatalf("forgotten state not restored: %v", err)
			}
		})
	}
}

func TestAIMemoryCheckoutUsesSelectedVersion(t *testing.T) {
	ctx := context.Background()
	repo := memoryCheckoutTestRepo(t, false)
	store := memory.NewStore(repo.DataPath)
	entry, err := store.Save(ctx, memorySyncTestRecord(), "missing", "remember")
	if err != nil {
		t.Fatal(err)
	}
	original := memoryCheckoutTestIndex(t, repo)
	record := entry.Record
	record.Content = "updated preference"
	updated, err := store.Save(ctx, record, entry.Revision, "edit")
	if err != nil {
		t.Fatal(err)
	}
	changed := memoryCheckoutTestIndex(t, repo)
	memoryCheckoutTestRestore(t, repo, original)
	got, err := store.Get(ctx, entry.Record.ID)
	if err != nil || got.Revision != entry.Revision {
		t.Fatalf("older version quarantined: %+v %v", got, err)
	}
	memoryCheckoutTestRestore(t, repo, changed)
	got, err = store.Get(ctx, entry.Record.ID)
	if err != nil || got.Revision != updated.Revision {
		t.Fatalf("newer version not restored: %+v %v", got, err)
	}
	raw, err := os.ReadFile(filepath.Join(repo.DataPath, "storage/ai/memory/records", entry.Record.ID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Quarantine(ctx, entry.Record.ID, [][]byte{raw}); err != nil {
		t.Fatal(err)
	}
	conflicted := memoryCheckoutTestIndex(t, repo)
	if _, err = store.Get(ctx, entry.Record.ID); !errors.Is(err, memory.ErrConflict) {
		t.Fatalf("existing conflict ignored: %v", err)
	}
	memoryCheckoutTestRestore(t, repo, original)
	if _, err = store.Get(ctx, entry.Record.ID); err != nil {
		t.Fatalf("conflict did not roll back: %v", err)
	}
	memoryCheckoutTestRestore(t, repo, conflicted)
	if _, err = store.Get(ctx, entry.Record.ID); !errors.Is(err, memory.ErrConflict) {
		t.Fatalf("conflict state not restored: %v", err)
	}
}

func memoryCheckoutTestFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(dir, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(dir, name)
		if err != nil {
			return err
		}
		files[relative] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestAIMemoryCheckoutAuxiliaryFilesFollowPlan(t *testing.T) {
	for _, sync := range []bool{false, true} {
		t.Run(map[bool]string{false: "snapshot", true: "sync-preflight"}[sync], func(t *testing.T) {
			repo := memoryCheckoutTestRepo(t, sync)
			names := []string{"storage/ai/memory/USER.md", "storage/ai/memory/MEMORY.md", "storage/ai/memory/conflicts/20261029000000-abcdefg/version.md", "storage/ai/memory/legacy-projections/version.md", "storage/ai/memory/operations/legacy.md", "storage/ai/memory/withdrawals/20261029000001-abcdefg.md", "storage/ai/memory/records/20261029000000-abcdefg.md", "assets/ordinary.txt"}
			for _, name := range names {
				writeCheckoutSourceTestFile(t, repo, name, []byte("older bytes"), 1)
			}
			beforeFiles := memoryCheckoutTestFiles(t, repo.DataPath)
			before := memoryCheckoutTestIndex(t, repo)
			for _, name := range names {
				writeCheckoutSourceTestFile(t, repo, name, []byte("newer bytes"), 2)
			}
			writeCheckoutSourceTestFile(t, repo, "storage/ai/memory/legacy-projections/added.md", []byte("added"), 2)
			writeCheckoutSourceTestFile(t, repo, "storage/ai/memory/conflicts/20261029000000-abcdefg/added.md", []byte("added"), 2)
			afterFiles := memoryCheckoutTestFiles(t, repo.DataPath)
			after := memoryCheckoutTestIndex(t, repo)
			memoryCheckoutTestRestore(t, repo, before)
			if got := memoryCheckoutTestFiles(t, repo.DataPath); !reflect.DeepEqual(got, beforeFiles) {
				t.Fatalf("checkout differs from target: %v", got)
			}
			memoryCheckoutTestRestore(t, repo, after)
			if got := memoryCheckoutTestFiles(t, repo.DataPath); !reflect.DeepEqual(got, afterFiles) {
				t.Fatalf("checkout differs from target: %v", got)
			}
			if _, err := memory.NewStore(repo.DataPath).Get(context.Background(), "20261029000000-abcdefg"); err == nil {
				t.Fatal("malformed memory became usable")
			}
		})
	}
}

func TestAIMemoryCheckoutPathSafety(t *testing.T) {
	for _, remove := range []bool{false, true} {
		for _, kind := range []string{"directory-link", "file-link", "directory", "parent-file", "traversal", "large-file", "missing"} {
			t.Run(kind+map[bool]string{false: "-upsert", true: "-remove"}[remove], func(t *testing.T) {
				dir := t.TempDir()
				outside := t.TempDir()
				name := memorySyncPrefix + "records/test.md"
				target := filepath.Join(dir, "storage/ai/memory/records/test.md")
				if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
					t.Fatal(err)
				}
				wantErr := true
				switch kind {
				case "directory-link":
					if err := os.Remove(filepath.Dir(target)); err != nil {
						t.Fatal(err)
					}
					if err := os.Symlink(outside, filepath.Dir(target)); err != nil {
						t.Skip(err)
					}
				case "file-link":
					if err := os.Symlink(filepath.Join(outside, "missing.md"), target); err != nil {
						t.Skip(err)
					}
				case "directory":
					if err := os.Mkdir(target, 0700); err != nil {
						t.Fatal(err)
					}
				case "parent-file":
					if err := os.Remove(filepath.Dir(target)); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Dir(target), []byte("not directory"), 0600); err != nil {
						t.Fatal(err)
					}
				case "traversal":
					name = memorySyncPrefix + "missing/../../outside.md"
				case "large-file":
					f, err := os.Create(target)
					if err != nil {
						t.Fatal(err)
					}
					err = f.Truncate(memory.MaxFileSize + 1)
					f.Close()
					if err != nil {
						t.Fatal(err)
					}
					wantErr = false
				case "missing":
					wantErr = false
				}
				plan := &dejavu.CheckoutPlan{}
				files := []*entity.File{{Path: name, Size: memory.MaxFileSize + 1}}
				if remove {
					plan.Removes = files
				} else {
					plan.Upserts = files
				}
				err := memoryCheckoutPreflight(dir, plan)
				if (err != nil) != wantErr {
					t.Fatalf("path result: %v, want error %v", err, wantErr)
				}
			})
		}
	}
}

func TestAIMemorySyncReadRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	if err := os.Symlink(t.TempDir(), filepath.Join(dir, "storage")); err != nil {
		t.Skip(err)
	}
	if _, err := memorySyncRead(dir, "/storage/ai/memory/records/test.md"); !errors.Is(err, memory.ErrInvalid) {
		t.Fatalf("symlink accepted: %v", err)
	}
}

func TestAIMemorySyncRoundTrip(t *testing.T) {
	for _, download := range []bool{false, true} {
		t.Run(map[bool]string{false: "merge", true: "download"}[download], func(t *testing.T) {
			previousConf, previousConfDir := Conf, util.ConfDir
			t.Cleanup(func() { Conf, util.ConfDir = previousConf, previousConfDir })
			Conf = &AppConf{Lang: "en"}
			util.ConfDir = t.TempDir()
			base := t.TempDir()
			newRepo := func(device string) *dejavu.Repo {
				dir := filepath.Join(base, device)
				backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: filepath.Join(dir, "repo"), AvailableSize: 1 << 30, Local: &cloud.ConfLocal{Endpoint: filepath.Join(base, "cloud")}}})
				repo, err := dejavu.NewRepo(filepath.Join(dir, "data"), filepath.Join(dir, "repo"), filepath.Join(dir, "history"), filepath.Join(dir, "temp"), device, device, "linux", []byte("0123456789abcdef0123456789abcdef"), nil, backend)
				if err != nil {
					t.Fatal(err)
				}
				repo.SetCheckoutHooks(dejavu.CheckoutHooks{Preflight: syncDocumentPreflight(repo)})
				return repo
			}
			source, target := newRepo("source"), newRepo("target")
			names := []string{"storage/ai/memory/legacy-projections/old.md", "storage/ai/memory/conflicts/20261029000000-abcdefg/old.md", "storage/ai/memory/USER.md", "storage/ai/memory/withdrawals/20261029000001-abcdefg.md", "assets/ordinary.txt"}
			for _, repo := range []*dejavu.Repo{source, target} {
				for _, name := range names {
					writeCheckoutSourceTestFile(t, repo, name, []byte("initial bytes"), 10)
				}
				memoryCheckoutTestIndex(t, repo)
				if _, _, err := repo.Sync(nil); err != nil {
					t.Fatal(err)
				}
			}
			for _, name := range names[:2] {
				if err := os.Remove(filepath.Join(source.DataPath, name)); err != nil {
					t.Fatal(err)
				}
			}
			for _, name := range names[2:] {
				writeCheckoutSourceTestFile(t, source, name, []byte("remote bytes"), 20)
			}
			memoryCheckoutTestIndex(t, source)
			if _, _, err := source.Sync(nil); err != nil {
				t.Fatal(err)
			}
			if download {
				if _, _, err := target.SyncDownload(nil); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, _, err := target.Sync(nil); err != nil {
					t.Fatal(err)
				}
			}
			if got, want := memoryCheckoutTestFiles(t, target.DataPath), memoryCheckoutTestFiles(t, source.DataPath); !reflect.DeepEqual(got, want) {
				t.Fatalf("sync differs from source: got %v want %v", got, want)
			}
			memoryCheckoutTestIndex(t, target)
			for range 2 {
				result, _, err := target.Sync(nil)
				if err != nil || result.DataChanged() {
					t.Fatalf("unchanged memory causes sync diff: %v %v", result, err)
				}
			}
		})
	}
}

func TestAIMemoryCheckoutMalformedRecordRemainsUnreadable(t *testing.T) {
	repo := memoryCheckoutTestRepo(t, false)
	id := "20261029000000-abcdefg"
	name := "storage/ai/memory/records/" + id + ".md"
	writeCheckoutSourceTestFile(t, repo, name, []byte("malformed record"), 1)
	snapshot := memoryCheckoutTestIndex(t, repo)
	writeCheckoutSourceTestFile(t, repo, name, []byte("different malformed record"), 2)
	memoryCheckoutTestIndex(t, repo)
	memoryCheckoutTestRestore(t, repo, snapshot)
	if _, err := memory.NewStore(repo.DataPath).Get(context.Background(), id); err == nil {
		t.Fatal("malformed record became usable")
	}
}

func TestAIMemorySyncConflictUsesRepositoryHistory(t *testing.T) {
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	a, b, _ := newSyncPerceptionTestClients(t, -1)
	for _, client := range []*syncPerceptionTestClient{a, b} {
		client.repo.SetCheckoutHooks(dejavu.CheckoutHooks{Preflight: syncDocumentPreflight(client.repo)})
	}
	ctx := context.Background()
	sa, sb := memory.NewStore(a.repo.DataPath), memory.NewStore(b.repo.DataPath)
	entry, err := sa.Save(ctx, memorySyncTestRecord(), "missing", "remember")
	if err != nil {
		t.Fatal(err)
	}
	a.index()
	if _, _, err = a.repo.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = b.repo.Sync(nil); err != nil {
		t.Fatal(err)
	}
	record := entry.Record
	record.Content = "device a preference"
	if _, err = sa.Save(ctx, record, entry.Revision, "edit-a"); err != nil {
		t.Fatal(err)
	}
	record.Content = "device b preference"
	if _, err = sb.Save(ctx, record, entry.Revision, "edit-b"); err != nil {
		t.Fatal(err)
	}
	for i, client := range []*syncPerceptionTestClient{a, b} {
		stamp := time.Now().Add(time.Duration(i+1) * time.Second)
		name := filepath.Join(client.repo.DataPath, "storage/ai/memory/records", entry.Record.ID+".md")
		if err = os.Chtimes(name, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	a.index()
	b.index()
	if _, _, err = a.repo.Sync(nil); err != nil {
		t.Fatal(err)
	}
	result, _, err := b.repo.Sync(nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.ConflictCount() != 1 || !result.HasHistory() {
		t.Fatalf("conflict history missing: %+v", result)
	}
	got, err := sb.Get(ctx, entry.Record.ID)
	if err != nil {
		t.Fatalf("repository-selected record quarantined: %v", err)
	}
	if got.Record.Content != "device a preference" && got.Record.Content != "device b preference" {
		t.Fatalf("unknown selected content: %q", got.Record.Content)
	}
	if conflict, err := sb.HasConflict(ctx, entry.Record.ID); err != nil || conflict {
		t.Fatalf("extra memory conflict created: %v %v", conflict, err)
	}
}

func TestAIMemoryCheckoutAllowsMetadataRemoval(t *testing.T) {
	for _, name := range []string{"conflicts/20261029000000-abcdefg/version.md", "legacy-projections/version.md"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			relative := "storage/ai/memory/" + name
			target := filepath.Join(dir, relative)
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, []byte("old bytes"), 0600); err != nil {
				t.Fatal(err)
			}
			plan := &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: "/" + relative}}}
			if err := memoryCheckoutPreflight(dir, plan); err != nil {
				t.Fatal(err)
			}
			if got, err := os.ReadFile(target); err != nil || string(got) != "old bytes" {
				t.Fatalf("preflight changed file: %q %v", got, err)
			}
		})
	}
}
