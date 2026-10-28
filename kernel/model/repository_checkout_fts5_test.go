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

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRepositoryCheckoutDirectReindexesUnderWriteGuard(t *testing.T) {
	const childEnv = "SIYUAN_TEST_REPO_CHECKOUT_GUARD"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestRepositoryCheckoutDirectReindexesUnderWriteGuard$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	Conf.Editor.Store(conf.NewEditor())
	Conf.Flashcard.Store(conf.NewFlashcard())
	Conf.FileTree.Store(conf.NewFileTree())
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	if err := ensureAllSyncAssets(); err != nil {
		t.Fatal(err)
	}
	id, _, err := CreateRepoSnapshotWithFullCheck("original", true)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, "seed.txt")
	if err = os.WriteFile(file, []byte("current"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = CheckoutRepoDirect(id); err != nil {
		t.Fatal(err)
	}
	if data, readErr := os.ReadFile(file); readErr != nil || string(data) != "seed" {
		t.Fatalf("restoration failed: %q %v", data, readErr)
	}
	backup, err := repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	if content := repoSnapshotTestContent(t, repo, backup.ID, "/seed.txt"); content != "current" {
		t.Fatalf("backup missing: %q", content)
	}
	if GetSyncCheckout("", "").Task != nil {
		t.Fatal("restore remained active after full reindex")
	}
	if !syncLock.TryLock() {
		t.Fatal("restore retained synchronization lock")
	}
	syncLock.Unlock()
	if !dataImportAccess.TryLock() {
		t.Fatal("restore retained write exclusion")
	}
	dataImportAccess.Unlock()
}
