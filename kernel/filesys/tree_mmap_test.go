// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeSameSecondSnapshot(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, root, _, _ := setupStalePathTest(t)
			originalProvider := DEKProvider
			originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
			key := bytes.Repeat([]byte{19}, 32)
			DEKProvider = func(string) ([]byte, error) {
				if encrypted {
					return bytes.Clone(key), nil
				}
				return nil, nil
			}
			DEKLockAcquire, DEKLockRelease = nil, nil
			t.Cleanup(func() {
				cache.ClearTreeCache()
				DEKProvider = originalProvider
				DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
			})
			tree := treenode.NewTree(box, "/"+root+".sy", "/Task", "Task")
			tree.Root.SetIALAttr("custom-deadline", "2026-10-16")
			if _, err := WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(util.DataDir, box, tree.Path)
			stamp := time.Unix(1700000100, 100000000)
			if err := os.Chtimes(file, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			base := t.TempDir()
			repo, err := dejavu.NewRepo(util.DataDir, filepath.Join(base, "repo"), filepath.Join(base, "history"), filepath.Join(base, "temp"),
				"device", "device", "test", []byte("0123456789abcdef0123456789abcdef"), nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			before, err := repo.Index("before", true, nil)
			if err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			tree.Root.SetIALAttr("custom-deadline", "2026-10-15")
			if _, err = WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			if err = os.Chtimes(file, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			updated, err := os.ReadFile(file)
			if err != nil || len(original) != len(updated) || bytes.Equal(original, updated) {
				t.Fatalf("expected equal-size change: %v", err)
			}
			after, err := repo.Index("after", true, nil)
			if err != nil || before.ID == after.ID {
				t.Fatalf("document change omitted: %v", err)
			}
			for _, version := range []struct {
				id, deadline string
				content      []byte
			}{
				{before.ID, "2026-10-16", original}, {after.ID, "2026-10-15", updated},
			} {
				if _, _, err = repo.Checkout(version.id, nil); err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(file)
				if err != nil || !bytes.Equal(data, version.content) {
					t.Fatalf("snapshot changed source bytes: %v", err)
				}
				cache.ClearTreeCache()
				loaded, err := LoadTree(box, tree.Path, util.NewLute())
				if err != nil || loaded.Root.IALAttr("custom-deadline") != version.deadline {
					t.Fatalf("authenticated document recovery: %v", err)
				}
			}
			if encrypted {
				state, err := os.ReadFile(filepath.Join(repo.Path, "file-state-v1.json"))
				if err != nil || bytes.Contains(state, []byte("custom-deadline")) || bytes.Contains(state, []byte("2026-10-15")) {
					t.Fatalf("local state disclosed document contents: %v", err)
				}
			}
		})
	}
}

func TestTreeAttributeMmapSnapshot(t *testing.T) {
	box, root, _, _ := setupStalePathTest(t)
	tree := treenode.NewTree(box, "/"+root+".sy", "/Task", "Task")
	tree.Root.SetIALAttr("custom-deadline", "2026-10-16")
	if _, err := WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, box, tree.Path)
	old := time.Now().Add(-10 * time.Second).Truncate(time.Second)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	repo, err := dejavu.NewRepo(util.DataDir, filepath.Join(base, "repo"), filepath.Join(base, "history"),
		filepath.Join(base, "temp"), "device", "device", "windows", []byte("0123456789abcdef0123456789abcdef"), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.Index("before attribute edit", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("custom-deadline", "2026-10-15")
	if _, err = WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(file)
	if err != nil || len(original) != len(updated) || bytes.Equal(original, updated) {
		t.Fatalf("attribute edit must change content without changing length: %v", err)
	}
	after, err := repo.Index("after attribute edit", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if before.ID == after.ID {
		t.Fatal("attribute edit was omitted from the next snapshot")
	}
	if err = os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.Checkout(after.ID, nil); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(restored, updated) {
		t.Fatalf("snapshot did not restore the updated attribute: %v", err)
	}
}
