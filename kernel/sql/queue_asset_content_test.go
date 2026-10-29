// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetContentQueueReportsWriteFailure(t *testing.T) {
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousQueue := assetContentDB, assetContentOperationQueue
	assetContentDB, assetContentOperationQueue = testDB, nil
	t.Cleanup(func() {
		_ = testDB.Close()
		assetContentDB, assetContentOperationQueue = previousDB, previousQueue
	})
	if _, err := testDB.Exec("CREATE TABLE asset_contents_fts_case_insensitive (id TEXT UNIQUE, name TEXT, ext TEXT, path TEXT, size INTEGER, updated INTEGER, content TEXT)"); err != nil {
		t.Fatal(err)
	}
	IndexAssetContentsQueue([]*AssetContent{{ID: "first", Path: "assets/test.txt", Content: "content"}})
	if err := FlushAssetContentQueue(); err != nil {
		t.Fatal(err)
	}
	IndexAssetContentsQueue([]*AssetContent{{ID: "first", Path: "assets/duplicate.txt"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("failed write reported success")
	}
	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM asset_contents_fts_case_insensitive").Scan(&count); err != nil || count != 1 {
		t.Fatalf("failed write damaged committed data: count=%d err=%v", count, err)
	}
	DeleteAssetContentsByPathQueue("assets/test.txt")
	if err := FlushAssetContentQueue(); err != nil {
		t.Fatal(err)
	}
	if err := testDB.Close(); err != nil {
		t.Fatal(err)
	}
	IndexAssetContentsQueue([]*AssetContent{{ID: "closed"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("closed database reported success")
	}
	assetContentDB = nil
	IndexAssetContentsQueue([]*AssetContent{{ID: "missing"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("unavailable database reported success")
	}
}

func TestAssetContentQueueReportsShutdown(t *testing.T) {
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousQueue, previousExiting := assetContentDB, assetContentOperationQueue, util.IsExiting.Load()
	assetContentDB, assetContentOperationQueue = testDB, nil
	t.Cleanup(func() {
		_ = testDB.Close()
		assetContentDB, assetContentOperationQueue = previousDB, previousQueue
		util.IsExiting.Store(previousExiting)
	})
	util.IsExiting.Store(true)
	IndexAssetContentsQueue([]*AssetContent{{ID: "shutdown"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("interrupted indexing reported success")
	}
}
