// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeWritesValidateCurrentSourceBehindCache(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, root, _, _ := setupStalePathTest(t)
			provider, acquire, release := DEKProvider, DEKLockAcquire, DEKLockRelease
			DEKLockAcquire, DEKLockRelease = nil, nil
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{23}, 32)
			}
			DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
			t.Cleanup(func() { DEKProvider, DEKLockAcquire, DEKLockRelease = provider, acquire, release })
			p := "/" + root + ".sy"
			tree := treenode.NewTree(box, p, "/Legacy", "Legacy")
			if _, err := WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(time.Second)
			for {
				if _, ok := cache.GetTreeDataInBox(root, box); ok {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("initial source was not cached")
				}
				time.Sleep(time.Millisecond)
			}
			tree.Root.SetIALAttr("title", "Edited from stale source")
			for _, source := range []struct {
				data string
				err  error
			}{
				{`{"Spec":"999","Properties":{"title":"Future"}}`, treenode.ErrSpecTooNew},
				{`{"Spec":"2","Properties":{"title":{"format":"future"}}}`, documentaddressing.ErrInvalidTitle},
			} {
				disk, err := encryptDataWithDEK(box, p, []byte(source.data), dek)
				if err != nil {
					t.Fatal(err)
				}
				abs := writeStalePathFixture(t, box, p, disk)
				if _, err = WriteTree(tree); !errors.Is(err, source.err) {
					t.Fatalf("stale tree overwrote unsupported source: %v", err)
				}
				if _, err = WriteTreeIfUnchanged(tree, disk); !errors.Is(err, source.err) {
					t.Fatalf("conditional write erased unsupported source: %v", err)
				}
				retained, _ := os.ReadFile(abs)
				if !bytes.Equal(retained, disk) {
					t.Fatal("unsupported source changed")
				}
				if encrypted {
					disk[len(disk)-1] ^= 1
					writeStalePathFixture(t, box, p, disk)
					if _, err = WriteTree(tree); err == nil || errors.Is(err, source.err) {
						t.Fatal("ordinary save bypassed source authentication", err)
					}
					retained, _ = os.ReadFile(abs)
					if !bytes.Equal(retained, disk) {
						t.Fatal("ordinary save replaced unauthenticated ciphertext")
					}
				}
			}
		})
	}
}

func TestTreeRepairPreservesChangedSource(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, _, p, legacy := setupStalePathTest(t)
			legacy = append([]byte("\xef\xbb\xbf"), legacy...)
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{23}, 32)
			}
			current, err := encryptDataWithDEK(box, p, []byte(`{"Spec":"999","Properties":{"title":"Future"}}`), dek)
			if err != nil {
				t.Fatal(err)
			}
			abs := writeStalePathFixture(t, box, p, current)
			_, _, err = fixTreeJSONData(box, p, legacy, util.NewLute(), dek, encrypted, true)
			if !errors.Is(err, util.ErrFileChanged) {
				t.Fatal("repair did not reject a changed source", err)
			}
			retained, _ := os.ReadFile(abs)
			if !bytes.Equal(retained, current) {
				t.Fatal("repair overwrote a newer source")
			}
		})
	}
}

func TestTreeSnapshotAndConditionalWrite(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, root, _, _ := setupStalePathTest(t)
			provider, acquire, release := DEKProvider, DEKLockAcquire, DEKLockRelease
			DEKLockAcquire, DEKLockRelease = nil, nil
			locked := false
			DEKProvider = func(string) ([]byte, error) {
				if locked {
					return nil, errors.New("locked notebook")
				}
				if encrypted {
					return bytes.Repeat([]byte{23}, 32), nil
				}
				return nil, nil
			}
			t.Cleanup(func() { DEKProvider, DEKLockAcquire, DEKLockRelease = provider, acquire, release })
			tree := treenode.NewTree(box, "/"+root+".sy", "/Source", "Source")
			if _, err := WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			stale, original, err := LoadTreeSnapshot(box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if util.IsCiphertext(original) != encrypted {
				t.Fatal("snapshot did not retain the native file representation")
			}
			tree.Root.SetIALAttr("title", "User edit")
			if _, err = WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(util.DataDir, box, tree.Path)
			current, _ := os.ReadFile(filename)
			stale.Root.SetIALAttr("title", "Stale replacement")
			if _, err = WriteTreeIfUnchanged(stale, original); !errors.Is(err, util.ErrFileChanged) {
				t.Fatal("stale snapshot overwrote a user edit", err)
			}
			after, _ := os.ReadFile(filename)
			if !bytes.Equal(current, after) {
				t.Fatal("failed conditional write changed the current file")
			}
			cached, _ := cache.GetTreeDataInBox(root, box)
			if bytes.Contains(cached, []byte("Stale replacement")) {
				t.Fatal("failed conditional write published a stale cache entry")
			}
			fresh, baseline, err := LoadTreeSnapshot(box, tree.Path, util.NewLute())
			if err != nil || !bytes.Equal(current, baseline) || fresh.Root.IALAttr("title") != "User edit" {
				t.Fatal("snapshot did not read the current native file", err)
			}
			fresh.Root.SetIALAttr("title", "Replacement")
			if _, err = WriteTreeIfUnchanged(fresh, baseline); err != nil {
				t.Fatal(err)
			}
			cache.RemoveTreeDataInBox(root, box)
			loaded, err := LoadTree(box, tree.Path, util.NewLute())
			if err != nil || loaded.Root.IALAttr("title") != "Replacement" {
				t.Fatal("successful conditional write cannot be read", err)
			}
			if encrypted {
				after, _ = os.ReadFile(filename)
				if !util.IsCiphertext(after) || bytes.Contains(after, []byte("Replacement")) {
					t.Fatal("conditional write exposed encrypted content")
				}
				bad := bytes.Clone(after)
				bad[len(bad)-1] ^= 1
				if err = os.WriteFile(filename, bad, 0644); err != nil {
					t.Fatal(err)
				}
				if _, _, err = LoadTreeSnapshot(box, tree.Path, util.NewLute()); err == nil {
					t.Fatal("snapshot substituted cached plaintext for corrupt ciphertext")
				}
				if err = os.WriteFile(filename, after, 0644); err != nil {
					t.Fatal(err)
				}
				if _, err = WriteTreeIfUnchanged(fresh, bad); err == nil {
					t.Fatal("conditional writer accepted unauthenticated source ciphertext")
				}
				locked = true
				if _, _, err = LoadTreeSnapshot(box, tree.Path, util.NewLute()); err == nil {
					t.Fatal("snapshot bypassed notebook locking")
				}
				if _, err = WriteTreeIfUnchanged(fresh, after); err == nil {
					t.Fatal("conditional writer bypassed notebook locking")
				}
				got, _ := os.ReadFile(filename)
				if !bytes.Equal(after, got) {
					t.Fatal("failed authenticated write changed ciphertext")
				}
				locked = false
			}
			_, baseline, err = LoadTreeSnapshot(box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if err = os.Remove(filename); err != nil {
				t.Fatal(err)
			}
			if _, err = WriteTreeIfUnchanged(fresh, baseline); !os.IsNotExist(err) {
				t.Fatal("conditional write recreated a deleted document", err)
			}
			if _, err = os.Stat(filename); !os.IsNotExist(err) {
				t.Fatal("deleted document was restored")
			}
		})
	}
}
