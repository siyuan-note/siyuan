// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRemoveAssetHashByPath(t *testing.T) {
	originalData := util.DataDir
	originalHashes, originalPaths := assetHashCache, assetPathHashCache
	t.Cleanup(func() {
		util.DataDir = originalData
		assetHashCache, assetPathHashCache = originalHashes, originalPaths
	})
	util.DataDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	const first, second = "assets/deleted.png", "assets/retained.png"
	if err := os.WriteFile(filepath.Join(util.DataDir, second), []byte("same content"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, lazy := range []bool{false, true} {
		assetHashCache, assetPathHashCache = map[string]*AssetHash{}, map[string]*AssetHash{}
		SetAssetHash("same-hash", first)
		SetAssetHash("same-hash", second)
		if lazy {
			if GetAssetHashByPath(first) != nil {
				t.Fatal("missing file returned from cache")
			}
		} else {
			RemoveAssetHashByPath(first)
		}
		if _, exists := assetPathHashCache[first]; exists {
			t.Fatal("deleted path remains cached")
		}
		if asset := GetAssetHash("same-hash"); asset == nil || asset.Path != second {
			t.Fatalf("other path's hash mapping was removed: %v", asset)
		}
		RemoveAssetHashByPath(first)
		RemoveAssetHashByPath(second)
		if len(assetHashCache) != 0 || len(assetPathHashCache) != 0 {
			t.Fatal("path removal did not clear both cache directions")
		}
	}
}

func TestSetAssetHashReplacesPath(t *testing.T) {
	originalHashes, originalPaths := assetHashCache, assetPathHashCache
	t.Cleanup(func() { assetHashCache, assetPathHashCache = originalHashes, originalPaths })
	assetHashCache, assetPathHashCache = map[string]*AssetHash{}, map[string]*AssetHash{}
	SetAssetHash("old-hash", "assets/replaced.png")
	SetAssetHash("new-hash", "assets/replaced.png")
	if _, exists := assetHashCache["old-hash"]; exists {
		t.Fatal("replaced contents retain the old hash")
	}
	if asset := assetPathHashCache["assets/replaced.png"]; asset == nil || asset.Hash != "new-hash" {
		t.Fatalf("new contents were not cached: %v", asset)
	}
}
