// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && !darwin

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetWatcherFileEvents(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_WATCHER_EVENTS"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestAssetWatcherFileEvents$", "-test.v", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	setupFileOperationTest(t)
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	write := func(p, content string) {
		t.Helper()
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	indexed := func(name, content string) bool {
		sql.FlushAssetContentQueue()
		rows, err := sql.QueryAssetContentNoLimitArgs("SELECT path FROM asset_contents_fts_case_insensitive WHERE path = ? AND content = ?", "assets/"+name, content)
		if err != nil {
			t.Fatal(err)
		}
		return len(rows) > 0
	}
	waitFor := func(name string, condition func() bool) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if condition() {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("timed out waiting for %s", name)
	}
	for _, name := range []string{"existing.txt", "removed-a.txt", "removed-b.txt", "photo.png"} {
		p := filepath.Join(assetsDir, name)
		write(p, "old contents")
		HandleAssetsChangeEvent(p)
	}
	sql.FlushAssetContentQueue()
	thumbnail := filepath.Join(util.TempDir, "thumbnails", "assets", "photo.png")
	if err := os.MkdirAll(filepath.Dir(thumbnail), 0755); err != nil {
		t.Fatal(err)
	}
	write(thumbnail, "cached image")
	cache.LoadAssets()

	// 属性变化和临时文件不应把同步计划视为内容变更。
	revision := pendingSync.begin()
	batch := assetWatchBatch{}
	batch.add(filepath.Join(assetsDir, "existing.txt"), false)
	batch.add(filepath.Join(assetsDir, ".hidden.txt"), true)
	batch.add(filepath.Join(assetsDir, "~$office.txt"), true)
	batch.add(filepath.Join(assetsDir, "save.tmp"), true)
	batch.flush()
	if pendingSync.begin() != revision {
		t.Fatal("metadata or temporary paths scheduled sync")
	}

	watchAssets()
	t.Cleanup(CloseWatchAssets)
	staging := t.TempDir()
	staged := filepath.Join(staging, "incoming.txt")
	write(staged, "new contents")
	planSyncAfter(time.Hour)
	revision = pendingSync.begin()
	if err := os.Rename(staged, filepath.Join(assetsDir, "created.txt")); err != nil {
		t.Fatal(err)
	}
	waitFor("create-only event to schedule sync and index contents", func() bool {
		return pendingSync.begin() > revision && cache.ExistAsset("assets/created.txt") && indexed("created.txt", "new contents")
	})
	syncPlanTimeLock.Lock()
	planned := syncPlanTime
	syncPlanTimeLock.Unlock()
	if !planned.Before(time.Now().Add(time.Minute)) {
		t.Fatal("asset creation did not advance the sync plan")
	}

	revision = pendingSync.begin()
	if err := os.Rename(filepath.Join(assetsDir, "created.txt"), filepath.Join(assetsDir, "renamed.txt")); err != nil {
		t.Fatal(err)
	}
	waitFor("rename to clean the old path and index the new path", func() bool {
		return pendingSync.begin() > revision && !cache.ExistAsset("assets/created.txt") &&
			cache.ExistAsset("assets/renamed.txt") && !indexed("created.txt", "new contents") && indexed("renamed.txt", "new contents")
	})

	existing := filepath.Join(assetsDir, "existing.txt")
	oldHash, err := util.GetEtag(existing)
	if err != nil {
		t.Fatal(err)
	}
	write(staged, "replacement contents")
	revision = pendingSync.begin()
	if err = os.Remove(existing); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(staged, existing); err != nil {
		t.Fatal(err)
	}
	waitFor("replacement to index final contents", func() bool {
		return pendingSync.begin() > revision && indexed("existing.txt", "replacement contents")
	})
	if cached := cache.GetAssetHash(oldHash); cached != nil && cached.Path == "assets/existing.txt" {
		t.Fatal("replacement retains the original contents' hash")
	}

	revision = pendingSync.begin()
	for _, name := range []string{"removed-a.txt", "removed-b.txt", "photo.png"} {
		if err = os.Remove(filepath.Join(assetsDir, name)); err != nil {
			t.Fatal(err)
		}
	}
	waitFor("consecutive deletions to clean every path and schedule sync", func() bool {
		_, thumbnailErr := os.Stat(thumbnail)
		return pendingSync.begin() > revision && !cache.ExistAsset("assets/removed-a.txt") &&
			!cache.ExistAsset("assets/removed-b.txt") && !cache.ExistAsset("assets/photo.png") && !indexed("removed-a.txt", "old contents") &&
			!indexed("removed-b.txt", "old contents") && os.IsNotExist(thumbnailErr)
	})

	// Moving the watched root leaves an old directory handle on Windows; bind the replacement.
	if err = os.Rename(assetsDir, filepath.Join(util.DataDir, "retired-assets")); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(assetsDir, "recreated.txt"), "recreated contents")
	waitFor("replacement root to reconcile missing and new files", func() bool {
		return !cache.ExistAsset("assets/existing.txt") && !indexed("existing.txt", "replacement contents") &&
			cache.ExistAsset("assets/recreated.txt") && indexed("recreated.txt", "recreated contents")
	})
	write(filepath.Join(assetsDir, "later.txt"), "later contents")
	waitFor("replacement root to receive subsequent events", func() bool {
		return cache.ExistAsset("assets/later.txt") && indexed("later.txt", "later contents")
	})
}
