// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHandleAssetsRemoveEvent(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_REMOVE_EVENT"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestHandleAssetsRemoveEvent$", "-test.v", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	fixture := setupFileOperationTest(t)
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	write := func(t *testing.T, p string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("asset content"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	index := func(p string) {
		sql.IndexAssetContentsQueue([]*sql.AssetContent{{ID: ast.NewNodeID(), Path: p, Content: "needle"}})
		sql.FlushAssetContentQueue()
	}
	assertIndexed := func(t *testing.T, p string, want bool) {
		t.Helper()
		rows, err := sql.QueryAssetContentNoLimitArgs("SELECT path FROM asset_contents_fts_case_insensitive WHERE path = ?", p)
		wantCount := 0
		if want {
			wantCount = 1
		}
		if err != nil || len(rows) != wantCount {
			t.Fatalf("index for %s: rows=%v err=%v, want present=%v", p, rows, err, want)
		}
	}
	for _, test := range []struct {
		name, path string
		deleted    bool
		ignored    bool
	}{
		{"before removal", "assets/before.png", false, false},
		{"after removal", "assets/after.png", true, false},
		{"nested removal", "assets/nested/Photo.JPG", true, false},
		{"content removal", "assets/content.txt", true, false},
		{"hidden", "assets/.hidden.png", true, true},
		{"office lock", "assets/~$office.png", true, true},
		{"temporary", "assets/file.tmp", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			absPath := filepath.Join(util.DataDir, filepath.FromSlash(test.path))
			thumbnail := filepath.Join(util.TempDir, "thumbnails", filepath.FromSlash(test.path))
			write(t, absPath)
			write(t, thumbnail)
			index(test.path)
			assertIndexed(t, test.path, true)
			hash, err := util.GetEtag(absPath)
			if err != nil {
				t.Fatal(err)
			}
			cache.SetAssetHash(hash, test.path)
			if test.deleted {
				if err = os.Remove(absPath); err != nil {
					t.Fatal(err)
				}
			}
			HandleAssetsRemoveEvent(absPath)
			sql.FlushAssetContentQueue()
			assertIndexed(t, test.path, test.ignored)
			if util.IsCompressibleAssetImage(test.path) {
				_, err = os.Stat(thumbnail)
				if test.ignored && err != nil || !test.ignored && !os.IsNotExist(err) {
					t.Errorf("thumbnail cleanup: %v, ignored=%v", err, test.ignored)
				}
			}
			if !test.ignored && cache.GetAssetHashByPath(test.path) != nil {
				t.Error("removed asset still has a hash mapping")
			}
			if !test.ignored {
				HandleAssetsRemoveEvent(absPath)
				sql.FlushAssetContentQueue()
				assertIndexed(t, test.path, false)
				write(t, absPath)
				HandleAssetsChangeEvent(absPath)
				sql.FlushAssetContentQueue()
				if filepath.Ext(test.path) == ".txt" {
					assertIndexed(t, test.path, true)
				}
				if cache.GetAssetHashByPath(test.path) == nil {
					t.Error("recreated asset was not cached")
				}
			}
			cache.RemoveAssetHash(hash)
		})
	}

	t.Run("encrypted resource preserves global caches", func(t *testing.T) {
		const p = "assets/encrypted.png"
		globalPath := filepath.Join(util.DataDir, filepath.FromSlash(p))
		write(t, globalPath)
		index(p)
		hash, _ := util.GetEtag(globalPath)
		cache.SetAssetHash(hash, p)
		markRuntimeEncryptedBox(fixture.box.ID)
		thumbnail := filepath.Join(util.TempDir, "thumbnails", filepath.FromSlash(p))
		write(t, thumbnail)
		HandleAssetsRemoveEvent(filepath.Join(util.DataDir, fixture.box.ID, filepath.FromSlash(p)))
		sql.FlushAssetContentQueue()
		assertIndexed(t, p, true)
		if cache.GetAssetHash(hash) == nil {
			t.Error("encrypted removal cleared the global hash cache")
		}
		if _, err := os.Stat(thumbnail); !os.IsNotExist(err) {
			t.Errorf("encrypted thumbnail remains: %v", err)
		}
	})
}
