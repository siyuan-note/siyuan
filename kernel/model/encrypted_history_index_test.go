// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build sqlcipher || libsqlcipher

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedHistoryAndIndexRecovery(t *testing.T) {
	const helperEnv = "SIYUAN_TEST_ENCRYPTED_HISTORY_INDEX"
	if os.Getenv(helperEnv) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEncryptedHistoryAndIndexRecovery$", "-test.v")
		cmd.Env = append(os.Environ(), helperEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("encrypted history/index regression failed: %v\n%s", err, output)
		}
		return
	}

	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.ConfDir = filepath.Join(root, "conf")
	util.HistoryDir = filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	Conf.Search = conf.NewSearch()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	password := "history-index-regression-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Encrypted history", password)
	if err != nil {
		t.Fatal(err)
	}
	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Closed = false
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	dek = bytes.Clone(dek)
	defer clear(dek)
	rootID := "20260907100000-history"
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/History", "History")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.IndexBlockTree(tree)
	sourcePath := filepath.Join(util.DataDir, boxID, rootID+".sy")
	historicalData, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	relHistory := filepath.Join("history", "2026-09-07-100000-update", boxID, rootID+".sy")
	historyPath := filepath.Join(root, relHistory)
	if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(historyPath, historicalData, 0600); err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("title", "Current")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	currentData, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("reject mismatched authenticated root ID", func(t *testing.T) {
		plain, err := DecryptFile(boxID, tree.Path, dek, historicalData)
		if err != nil {
			t.Fatal(err)
		}
		plain = bytes.ReplaceAll(plain, []byte(rootID), []byte("20260907100001-history"))
		badHistory, err := EncryptFile(boxID, tree.Path, dek, plain)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(historyPath, badHistory, 0600); err != nil {
			t.Fatal(err)
		}
		defer os.WriteFile(historyPath, historicalData, 0600)
		if _, _, _, _, err = GetDocHistoryContent(relHistory, "", false); err == nil {
			t.Fatal("history preview accepted a mismatched root ID")
		}
		if err = RollbackDocHistory(relHistory); err == nil || !strings.Contains(err.Error(), "root ID") {
			t.Fatalf("history rollback did not validate the authenticated root ID: %v", err)
		}
		assertEncryptedFileBytes(t, sourcePath, currentData)
	})

	t.Run("write failure preserves current document and index", func(t *testing.T) {
		provider := filesys.DEKProvider
		defer func() { filesys.DEKProvider = provider }()
		failure := errors.New("injected history write failure")
		filesys.DEKProvider = func(string) ([]byte, error) { return nil, failure }
		if err := RollbackDocHistory(relHistory); !errors.Is(err, failure) {
			t.Fatalf("write failure was not propagated: %v", err)
		}
		assertEncryptedFileBytes(t, sourcePath, currentData)
		if treenode.GetBlockTree(rootID) == nil {
			t.Fatal("failed rollback removed the current index")
		}
	})

	t.Run("rollback finishes while lock waits", func(t *testing.T) {
		acquire := filesys.DEKLockAcquire
		defer func() { filesys.DEKLockAcquire = acquire }()
		var once sync.Once
		locked := make(chan struct{})
		filesys.DEKLockAcquire = func(id string) {
			once.Do(func() {
				go func() {
					LockBox(boxID)
					close(locked)
				}()
				deadline := time.Now().Add(time.Second)
				for GetEncryptedBoxState(boxID) != EncryptedBoxStateLocking && time.Now().Before(deadline) {
					time.Sleep(time.Millisecond)
				}
				if GetEncryptedBoxState(boxID) != EncryptedBoxStateLocking {
					t.Error("lock did not wait for rollback")
				}
			})
			acquire(id)
		}
		if err := RollbackDocHistory(relHistory); err != nil {
			t.Fatal(err)
		}
		select {
		case <-locked:
		case <-time.After(3 * time.Second):
			t.Fatal("lock did not finish after rollback")
		}
		data, err := os.ReadFile(sourcePath)
		if err != nil {
			t.Fatal(err)
		}
		plain, err := DecryptFile(boxID, tree.Path, dek, data)
		if err != nil {
			t.Fatal(err)
		}
		restored, err := loadTreeByData0(plain)
		if err != nil || restored.Root.ID != rootID || restored.Root.IALAttr("title") != "History" {
			t.Fatalf("unexpected restored document: %v", err)
		}
		assertEncryptedFileBytes(t, historyPath, historicalData)
	})

	t.Run("corrupt indexes rebuild after source authentication", func(t *testing.T) {
		for _, dbPath := range []string{util.EncryptedDBPath(boxID), util.EncryptedBlockTreeDBPath(boxID)} {
			if err := os.WriteFile(dbPath, []byte("damaged index"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		crypt, err := GetBoxEncryption(boxID)
		if err != nil {
			t.Fatal(err)
		}
		if err := UnlockBox(boxID, password, crypt); err != nil {
			t.Fatalf("unlock could not rebuild damaged indexes: %v", err)
		}
		if err := util.CheckEncryptedIndexCompatibility(sql.GetEncryptedDB(boxID), "content", 1); err != nil {
			t.Fatal(err)
		}
	})

	for _, mutation := range []string{
		"DROP TABLE encrypted_index_meta",
		"UPDATE encrypted_index_meta SET schema_version = 2",
		"UPDATE encrypted_index_meta SET kind = 'blocktree'",
		"UPDATE encrypted_index_meta SET cipher_settings = '{}'",
	} {
		t.Run("incompatible index preserves source: "+mutation, func(t *testing.T) {
			db := sql.GetEncryptedDB(boxID)
			if _, err := db.Exec(mutation); err != nil {
				t.Fatal(err)
			}
			sql.CloseEncryptedDB(boxID)
			treenode.CloseEncryptedBlockTreeDB(boxID)
			before, err := os.ReadFile(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			if err = openEncryptedBoxIndexes(boxID, dek); err != nil {
				t.Fatal(err)
			}
			assertEncryptedFileBytes(t, sourcePath, before)
		})
	}

	t.Run("source authentication failure preserves residual indexes", func(t *testing.T) {
		sql.CloseEncryptedDB(boxID)
		treenode.CloseEncryptedBlockTreeDB(boxID)
		for _, dbPath := range []string{util.EncryptedDBPath(boxID), util.EncryptedBlockTreeDBPath(boxID)} {
			if err := os.WriteFile(dbPath, []byte("preserve damaged index"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(sourcePath, []byte("invalid source ciphertext"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := openEncryptedBoxIndexes(boxID, dek); err == nil {
			t.Fatal("index recovery accepted unauthenticated source data")
		}
		assertEncryptedFileBytes(t, sourcePath, []byte("invalid source ciphertext"))
		for _, dbPath := range []string{util.EncryptedDBPath(boxID), util.EncryptedBlockTreeDBPath(boxID)} {
			assertEncryptedFileBytes(t, dbPath, []byte("preserve damaged index"))
		}
	})
	cache.ClearTreeCache()
}

func assertEncryptedFileBytes(t *testing.T, filePath string, expected []byte) {
	t.Helper()
	actual, err := os.ReadFile(filePath)
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatalf("unexpected file change [%s]: %v", filepath.Base(filePath), err)
	}
}
