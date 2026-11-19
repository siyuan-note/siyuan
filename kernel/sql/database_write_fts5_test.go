// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package sql

import (
	"bytes"
	"context"
	stdsql "database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDatabaseWriteRecovery(t *testing.T) {
	const scenarioEnv, rootEnv = "SIYUAN_TEST_DATABASE_WRITE", "SIYUAN_TEST_DATABASE_WRITE_ROOT"
	scenario := os.Getenv(scenarioEnv)
	if scenario == "" {
		for _, name := range []string{"asset-delete", "asset-insert", "asset-prepare", "history-delete", "history-insert", "encrypted", "unknown", "main"} {
			t.Run(name, func(t *testing.T) {
				root := t.TempDir()
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDatabaseWriteRecovery$", "-test.timeout=45s", "-test.v")
				cmd.Env = append(os.Environ(), scenarioEnv+"="+name, rootEnv+"="+root)
				output, err := cmd.CombinedOutput()
				if name == "main" {
					var exitErr *exec.ExitError
					if !errors.As(err, &exitErr) || exitErr.ExitCode() != logging.ExitCodeUnavailableDatabase {
						t.Fatalf("main database recovery did not request a restart: %v\n%s", err, output)
					}
					if !bytes.Contains(output, []byte("database ["+filepath.Join(root, "siyuan.db")+"] is unavailable:")) {
						t.Fatalf("main database failure omitted its path or original error:\n%s", output)
					}
				} else if err != nil {
					t.Fatalf("database write recovery subprocess: %v\n%s", err, output)
				}
			})
		}
		return
	}

	root := os.Getenv(rootEnv)
	util.WorkspaceDir, util.TempDir, util.ConfDir = root, root, root
	util.DataDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath, util.BlockTreeDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "blocktree.db")
	util.AssetContentDBPath, util.HistoryDBPath = filepath.Join(root, "asset_content.db"), filepath.Join(root, "history.db")
	logging.SetLogPath(filepath.Join(root, "siyuan.log"))
	InitDatabase(true)
	InitHistoryDatabase(true)
	if err := InitAssetContentDatabase(true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(CloseDatabase)
	if _, err := db.Exec("CREATE TABLE recovery_sentinel (value TEXT); INSERT INTO recovery_sentinel VALUES ('preserved')"); err != nil {
		t.Fatal(err)
	}
	mainDB := db
	blockTreeBefore, err := os.ReadFile(util.BlockTreeDBPath)
	if err != nil {
		t.Fatal(err)
	}

	assetRebuilds, historyRebuilds := 0, 0
	eventbus.Subscribe(util.EvtSQLAssetContentRebuild, func() { assetRebuilds++ })
	eventbus.Subscribe(util.EvtSQLHistoryRebuild, func() { historyRebuilds++ })
	wantPath := "unknown"
	var writeErr error
	switch scenario {
	case "asset-delete", "asset-insert", "asset-prepare":
		wantPath = util.AssetContentDBPath
		IndexAssetContentsQueue([]*AssetContent{{ID: "before", Path: "assets/test.txt", Content: "needle"}})
		if err := FlushAssetContentQueue(); err != nil {
			t.Fatal(err)
		}
		corruptDatabaseWriteFTS(t, assetContentDB, "asset_contents_fts_case_insensitive")
		if scenario == "asset-prepare" {
			if err := assetContentDB.Close(); err != nil {
				t.Fatal(err)
			}
			assetContentDB = nil
			initAssetContentDBConnection()
		}
		if scenario == "asset-delete" {
			DeleteAssetContentsByPathQueue("assets/test.txt")
		} else {
			IndexAssetContentsQueue([]*AssetContent{{ID: "failed", Path: "assets/failed.txt", Content: "needle"}})
		}
		writeErr = FlushAssetContentQueue()
		if assetRebuilds != 1 || historyRebuilds != 0 {
			t.Fatalf("incorrect rebuild destination: assets=%d history=%d", assetRebuilds, historyRebuilds)
		}
		if err := InitAssetContentDatabase(true); err != nil {
			t.Fatal(err)
		}
		IndexAssetContentsQueue([]*AssetContent{{ID: "recovered", Path: "assets/test.txt", Content: "recovered needle"}})
		if err := FlushAssetContentQueue(); err != nil {
			t.Fatalf("rebuilt resource index remained unavailable: %v", err)
		}
		var content string
		if err := assetContentDB.QueryRow("SELECT content FROM asset_contents_fts_case_insensitive WHERE id = 'recovered'").Scan(&content); err != nil || content != "recovered needle" {
			t.Fatalf("rebuilt resource index lost content: %q, %v", content, err)
		}
	case "history-delete", "history-insert":
		wantPath = util.HistoryDBPath
		history := &History{ID: "history", Path: "snapshot/notebook/document.sy", Content: "needle", Created: "20261112000000"}
		IndexHistoriesQueue([]*History{history})
		FlushHistoryQueue()
		snapshot := filepath.Join(util.HistoryDir, filepath.FromSlash(history.Path))
		if err := os.MkdirAll(filepath.Dir(snapshot), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(snapshot, []byte("original snapshot"), 0644); err != nil {
			t.Fatal(err)
		}
		corruptDatabaseWriteFTS(t, historyDB, "histories_fts_case_insensitive")
		if scenario == "history-delete" {
			DeleteOutdatedHistories(20261113000000)
		} else {
			IndexHistoriesQueue([]*History{history})
		}
		FlushHistoryQueue()
		if historyRebuilds != 1 || assetRebuilds != 0 {
			t.Fatalf("incorrect rebuild destination: assets=%d history=%d", assetRebuilds, historyRebuilds)
		}
		if data, err := os.ReadFile(snapshot); err != nil || string(data) != "original snapshot" {
			t.Fatalf("index failure removed original history: %q, %v", data, err)
		}
	case "encrypted":
		boxID := "20261112000000-private"
		key := bytes.Repeat([]byte{39}, 32)
		if err := OpenEncryptedDB(boxID, key); err != nil {
			t.Fatal(err)
		}
		defer CloseEncryptedDB(boxID)
		wantPath = util.EncryptedDBPath(boxID)
		target := GetEncryptedDB(boxID)
		if _, err := target.Exec("CREATE TABLE recovery_sentinel (value TEXT); INSERT INTO recovery_sentinel VALUES ('private'); CREATE VIRTUAL TABLE write_fixture USING fts5(content); INSERT INTO write_fixture VALUES ('needle')"); err != nil {
			t.Fatal(err)
		}
		corruptDatabaseWriteFTS(t, target, "write_fixture")
		tx, err := beginTxForBox(boxID)
		if err != nil {
			t.Fatal(err)
		}
		writeErr = prepareExecInsertTx(tx, "INSERT INTO write_fixture VALUES (?)", []any{"changed"})
		CloseEncryptedDB(boxID)
		if err := OpenEncryptedDB(boxID, key); err != nil {
			t.Fatalf("failed write prevented reopening encrypted data: %v", err)
		}
		var value string
		if err := GetEncryptedDB(boxID).QueryRow("SELECT value FROM recovery_sentinel").Scan(&value); err != nil || value != "private" {
			t.Fatalf("encrypted database was discarded: %q, %v", value, err)
		}
	case "unknown":
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		tx.Rollback()
		writeErr = errors.New("database disk image is malformed")
		handleDatabaseWriteError(tx, "DELETE FROM unknown", nil, writeErr)
	case "main":
		if _, err := db.Exec("CREATE VIRTUAL TABLE write_fixture USING fts5(content); INSERT INTO write_fixture VALUES ('needle')"); err != nil {
			t.Fatal(err)
		}
		corruptDatabaseWriteFTS(t, db, "write_fixture")
		tx, err := beginTx()
		if err != nil {
			t.Fatal(err)
		}
		execStmtTx(tx, "DELETE FROM write_fixture WHERE content = ?", "needle")
		t.Fatal("corrupt main database did not request a restart")
	default:
		t.Fatalf("unknown scenario %q", scenario)
	}
	if !strings.HasPrefix(scenario, "history-") && !isRecoverableDBFileError(writeErr) {
		t.Fatalf("corruption was not returned to the caller: %v", writeErr)
	}
	var value string
	if db != mainDB {
		t.Fatal("unrelated main database connection was replaced")
	}
	if err := db.QueryRow("SELECT value FROM recovery_sentinel").Scan(&value); err != nil || value != "preserved" {
		t.Fatalf("unrelated main database was rebuilt: %q, %v", value, err)
	}
	if blockTreeAfter, err := os.ReadFile(util.BlockTreeDBPath); err != nil || !bytes.Equal(blockTreeBefore, blockTreeAfter) {
		t.Fatalf("unrelated block-tree index was changed: %v", err)
	}
	logData, err := os.ReadFile(logging.LogPath)
	if err != nil {
		t.Fatal(err)
	}
	// Windows 上 SQLite 返回的路径分隔符可能与工作空间配置不同。
	logText := strings.ReplaceAll(string(logData), "\\", "/")
	wantCause := "corruption found reading blob 1"
	if scenario == "unknown" {
		wantCause = writeErr.Error()
	}
	if !strings.Contains(logText, "exec database ["+filepath.ToSlash(wantPath)+"] stmt [") ||
		!strings.Contains(logText, wantCause) || strings.Contains(logText, "database [unknown] is unavailable") {
		t.Fatalf("database failure was misattributed or omitted its cause:\n%s", logText)
	}
	if len(txStmtCache) != 0 {
		t.Fatal("failed transaction retained prepared statements")
	}
}

func corruptDatabaseWriteFTS(t *testing.T, target *stdsql.DB, table string) {
	t.Helper()
	// 缺少 FTS5 统计记录时，下一次写入会由 SQLite 返回真实的损坏错误。
	if _, err := target.Exec("DELETE FROM " + table + "_data WHERE id = 1"); err != nil {
		t.Fatal(err)
	}
}
