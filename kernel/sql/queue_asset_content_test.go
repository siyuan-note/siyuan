// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetContentQueueRebuildsAfterTransactionFailure(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_TRANSACTION_FAILURE"
	if os.Getenv(childEnv) == "" {
		for _, stage := range []string{"begin", "commit"} {
			t.Run(stage, func(t *testing.T) {
				cmd := exec.Command(os.Args[0], "-test.run=^TestAssetContentQueueRebuildsAfterTransactionFailure$", "-test.timeout=30s")
				cmd.Env = append(os.Environ(), childEnv+"="+stage)
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("asset transaction failure subprocess: %v\n%s", err, output)
				}
			})
		}
		return
	}
	for _, stage := range []string{"begin", "commit"} {
		if os.Getenv(childEnv) != stage {
			continue
		}
		t.Run(stage, func(t *testing.T) {
			driverName := fmt.Sprintf("asset-content-%s-%d", stage, time.Now().UnixNano())
			sql.Register(driverName, assetContentFailingDriver{stage: stage})
			testDB, err := sql.Open(driverName, ":memory:")
			if err != nil {
				t.Fatal(err)
			}
			testDB.SetMaxOpenConns(1)
			previousDB, previousQueue := assetContentDB, assetContentOperationQueue
			assetContentDB, assetContentOperationQueue = testDB, nil
			rebuilds := 0
			handler := func() { rebuilds++ }
			eventbus.Subscribe(util.EvtSQLAssetContentRebuild, handler)
			t.Cleanup(func() {
				testDB.Close()
				assetContentDB, assetContentOperationQueue = previousDB, previousQueue
			})
			if _, err := testDB.Exec("CREATE TABLE asset_contents_fts_case_insensitive (id, name, ext, path, size, updated, content)"); err != nil {
				t.Fatal(err)
			}
			IndexAssetContentsQueue([]*AssetContent{{ID: "failed", Path: "assets/test.txt"}})
			if err := FlushAssetContentQueue(); !isRecoverableDBFileError(err) || rebuilds != 1 {
				t.Fatalf("%s failure did not request asset recovery: err=%v rebuilds=%d", stage, err, rebuilds)
			}
			var count int
			if err := testDB.QueryRow("SELECT COUNT(*) FROM asset_contents_fts_case_insensitive").Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed transaction committed partial data: count=%d err=%v", count, err)
			}
		})
	}
}

type assetContentFailingDriver struct {
	stage string
}

func (d assetContentFailingDriver) Open(name string) (driver.Conn, error) {
	conn, err := (&sqlite3.SQLiteDriver{}).Open(name)
	if err != nil {
		return nil, err
	}
	return assetContentFailingConnection{Conn: conn, stage: d.stage}, nil
}

type assetContentFailingConnection struct {
	driver.Conn
	stage string
}

func (conn assetContentFailingConnection) Begin() (driver.Tx, error) {
	if conn.stage == "begin" {
		return nil, sqlite3.Error{Code: sqlite3.ErrCorrupt}
	}
	tx, err := conn.Conn.Begin()
	if err != nil {
		return nil, err
	}
	return assetContentFailingTransaction{Tx: tx}, nil
}

type assetContentFailingTransaction struct {
	driver.Tx
}

func (tx assetContentFailingTransaction) Commit() error {
	tx.Tx.Rollback()
	return sqlite3.Error{Code: sqlite3.ErrCorrupt}
}

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
