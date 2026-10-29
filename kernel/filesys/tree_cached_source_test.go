// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func waitForCachedSource(t testing.TB, boxID, id string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		if _, ok := cache.GetTreeDataInBox(id, boxID); ok {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("source cache was not published")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCachedTreeSourcePreservesCompleteTreeAndCapturedParent(t *testing.T) {
	for _, title := range []string{"Parent", ""} {
		t.Run("parent="+title, func(t *testing.T) {
			boxID, parentID, p, data := setupStalePathTest(t)
			childPath := writeStalePathFixture(t, boxID, p, data)
			parent := treenode.NewTree(boxID, "/"+parentID+".sy", "/"+title, title)
			if _, err := WriteTree(parent); err != nil {
				t.Fatal(err)
			}
			luteEngine := util.NewLute()
			want, err := LoadTree(boxID, p, luteEngine)
			if err != nil {
				t.Fatal(err)
			}
			waitForCachedSource(t, boxID, want.ID)
			source, err := CaptureCachedTreeSource(boxID, p)
			if err != nil || source == nil {
				t.Fatalf("could not capture warm source: %v", err)
			}
			parent.Root.SetIALAttr("title", "Renamed")
			if _, err = WriteTree(parent); err != nil {
				t.Fatal(err)
			}
			if err = os.Remove(childPath); err != nil {
				t.Fatal(err)
			}
			cache.RemoveTreeDataInBox(want.ID, boxID)
			got, err := source.Parse(luteEngine)
			if err != nil {
				t.Fatal(err)
			}
			if got.Box != want.Box || got.Path != want.Path || got.HPath != want.HPath || got.Hash != want.Hash ||
				!bytes.Equal(render.NewJSONRenderer(got, luteEngine.RenderOptions, luteEngine.ParseOptions).Render(),
					render.NewJSONRenderer(want, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()) {
				t.Fatal("snapshot parsing changed source projection or used later parent metadata")
			}
			got.Root.SetIALAttr("title", "Mutated local tree")
			again, err := source.Parse(luteEngine)
			if err != nil || again.Root.IALAttr("title") != want.Root.IALAttr("title") {
				t.Fatalf("snapshot parsing shared mutable tree state: %v", err)
			}
			if _, err = os.Stat(childPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("snapshot parsing recreated a removed source")
			}
		})
	}
}

func TestCachedTreeSourceRetainsFallbackAndAuthorization(t *testing.T) {
	boxID, _, p, data := setupStalePathTest(t)
	filePath := writeStalePathFixture(t, boxID, p, data)
	id := util.GetTreeID(p)
	if source, err := CaptureCachedTreeSource(boxID, p); err != nil || source != nil {
		t.Fatalf("cache miss should retain complete loading: %v", err)
	}
	cache.SetTreeDataInBox(id, boxID, data)
	waitForCachedSource(t, boxID, id)
	if source, err := CaptureCachedTreeSource(boxID, p); err != nil || source != nil {
		t.Fatalf("missing parent should retain complete repair: %v", err)
	}
	if err := os.Remove(filePath); err != nil {
		t.Fatal(err)
	}
	if _, err := CaptureCachedTreeSource(boxID, p); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale cached path was accepted: %v", err)
	}
	if _, err := CaptureCachedTreeSource(boxID, "/../conf.json"); err == nil {
		t.Fatal("invalid source path was accepted")
	}
	oldProvider, oldAcquire, oldRelease := DEKProvider, DEKLockAcquire, DEKLockRelease
	DEKLockAcquire, DEKLockRelease = nil, nil
	t.Cleanup(func() { DEKProvider, DEKLockAcquire, DEKLockRelease = oldProvider, oldAcquire, oldRelease })
	DEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{19}, 32), nil }
	if source, err := CaptureCachedTreeSource(boxID, p); err != nil || source != nil {
		t.Fatalf("encrypted source entered the ordinary snapshot path: %v", err)
	}
	locked := errors.New("notebook locked")
	DEKProvider = func(string) ([]byte, error) { return nil, locked }
	if _, err := CaptureCachedTreeSource(boxID, p); !errors.Is(err, locked) {
		t.Fatalf("cache capture bypassed authorization: %v", err)
	}
}

func TestCachedTreeSourceIgnoresRetiredModeAndValidatesSpec(t *testing.T) {
	boxID, id, _, _ := setupStalePathTest(t)
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	writeStalePathFixture(t, boxID, documentaddressing.ConfigPath, []byte(`{"documentAddressingVersion":2}`))
	p := "/" + id + ".sy"
	tree := treenode.NewTree(boxID, p, "/Captured/title", "Captured/title")
	if _, err := WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	waitForCachedSource(t, boxID, id)
	source, err := CaptureCachedTreeSource(boxID, p)
	if err != nil || source == nil {
		t.Fatalf("could not capture mode 2 source: %v", err)
	}
	filePath := filepath.Join(util.DataDir, boxID, p)
	original, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}

	// Retired diagnostic markers do not change supported source reads.
	writeStalePathFixture(t, boxID, documentaddressing.ConfigPath, []byte(`{"documentAddressingVersion":3}`))
	luteEngine := util.NewLute()
	captured, err := source.Parse(luteEngine)
	if err != nil || captured.Root.Spec != treenode.DocumentTitleSpec || captured.Root.IALAttr("title") != "Captured/title" {
		t.Fatalf("captured source changed with later notebook metadata: %v", err)
	}
	for _, access := range []struct {
		name string
		run  func() error
	}{
		{"capture", func() error { _, err := CaptureCachedTreeSource(boxID, p); return err }},
		{"cached load", func() error { _, err := LoadTree(boxID, p, luteEngine); return err }},
		{"data load", func() error { _, err := LoadTreeByData(source.data, boxID, p, luteEngine); return err }},
		{"snapshot load", func() error { _, _, err := LoadTreeSnapshot(boxID, p, luteEngine); return err }},
		{"header load", func() error { _, err := DocIAL(filePath); return err }},
		{"write", func() error { _, err := WriteTree(captured); return err }},
	} {
		t.Run(access.name, func(t *testing.T) {
			if err := access.run(); err != nil {
				t.Fatalf("retired mode blocked source access: %v", err)
			}
		})
	}
	if got, err := os.ReadFile(filePath); err != nil || !bytes.Equal(got, original) {
		t.Fatalf("rejected access changed source bytes: %v", err)
	}

	// 捕获能力不会绕过源格式校验。
	var document map[string]any
	if err = json.Unmarshal(source.data, &document); err != nil {
		t.Fatal(err)
	}
	document["Spec"] = "999"
	unsupported := *source
	unsupported.data, err = json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = unsupported.Parse(luteEngine); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatalf("captured mode bypassed source format validation: %v", err)
	}
}
