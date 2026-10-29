// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build sqlcipher || libsqlcipher

package model

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const createEncryptedBoxTestHelperEnv = "SIYUAN_TEST_CREATE_ENCRYPTED_BOX"

func TestCreateEncryptedBoxInitializesBoxDocument(t *testing.T) {
	if os.Getenv(createEncryptedBoxTestHelperEnv) == "1" {
		testCreateEncryptedBoxInitializesBoxDocument(t)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCreateEncryptedBoxInitializesBoxDocument$")
	cmd.Env = append(os.Environ(), createEncryptedBoxTestHelperEnv+"=1")
	output, err := cmd.CombinedOutput()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatalf("creating an encrypted notebook timed out:\n%s", output)
	}
	if err != nil {
		t.Fatalf("encrypted notebook creation helper failed: %v\n%s", err, output)
	}
}

func testCreateEncryptedBoxInitializesBoxDocument(t *testing.T) {
	root := t.TempDir()
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
	Conf.FileTree.Store(conf.NewFileTree())
	Conf.FileTree.Load().BoxDocEnabled = true
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync.Store(conf.NewSync())
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	Conf.Search.Store(conf.NewSearch())
	Conf.Lang, util.Lang = "en", "en"
	util.WorkingDir, _ = filepath.Abs(filepath.Join("..", "..", "app"))
	initLang()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	password := "create-encrypted-notebook-test"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatalf("enable encrypted notebooks failed: %v", err)
	}

	boxID, err := CreateEncryptedBox("Encrypted", password)
	if err != nil {
		t.Fatalf("create encrypted notebook failed: %v", err)
	}
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateUnlocked {
		t.Fatalf("expected Unlocked state after creation, got %s", state)
	}
	boxDocData, err := os.ReadFile(filepath.Join(util.DataDir, boxID, boxDocPath(boxID)))
	if err != nil {
		t.Fatalf("read encrypted notebook document failed: %v", err)
	}
	if !util.IsCiphertext(boxDocData) {
		t.Fatal("encrypted notebook document was stored as plaintext")
	}
	tree, err := filesys.LoadTree(boxID, boxDocPath(boxID), util.NewLute())
	if err != nil {
		t.Fatalf("load encrypted notebook document failed: %v", err)
	}
	if tree.ID != boxID {
		t.Fatalf("unexpected encrypted notebook document ID: %s", tree.ID)
	}
	for _, enabled := range []bool{true, false} {
		Conf.FileTree.Load().BoxDocEnabled = enabled
		if !enabled {
			if boxID, err = CreateEncryptedBox("Encrypted without notebook document", password); err != nil {
				t.Fatal(err)
			}
		}
		if state := treenode.DocumentMetadataState(boxID); state != "ready" {
			t.Fatalf("new encrypted notebook metadata state = %q, want ready (notebook document: %v)", state, enabled)
		}
		if _, err = Mount(boxID); err != nil {
			t.Fatalf("mount new encrypted notebook: %v", err)
		}
		if state := treenode.DocumentMetadataState(boxID); state != "building" {
			t.Fatalf("queued encrypted notebook index state = %q, want building", state)
		}
		for task.ContainIndexTask() {
			task.ExecTaskJob()
		}
		documentID := ast.NewNodeID()
		if _, err = CreateDocByParent(DocumentCreateRequest{Notebook: boxID, ID: documentID,
			TitleFormat: "plain", Title: "Encrypted document", Markdown: "Encrypted notebook creation"}); err != nil {
			t.Fatalf("create document immediately after encrypted notebook creation: %v", err)
		}
		if tree, err = filesys.LoadTree(boxID, "/"+documentID+".sy", util.NewLute()); err != nil || tree.ID != documentID {
			t.Fatalf("read new encrypted document: %+v, %v", tree, err)
		}
		data, readErr := os.ReadFile(filepath.Join(util.DataDir, boxID, documentID+".sy"))
		if readErr != nil || !util.IsCiphertext(data) {
			t.Fatalf("new encrypted document was not stored as ciphertext: %v", readErr)
		}
	}
	Conf.FileTree.Load().BoxDocEnabled = true

	if _, err = CreateBox("Normal"); err != nil {
		t.Fatalf("create normal notebook after encrypted notebook failed: %v", err)
	}

	expectedInitializationError := errors.New("injected notebook document initialization failure")
	failedBoxID := ""
	_, err = createEncryptedBox("Failure", password, func(boxID string) (string, error) {
		failedBoxID = boxID
		if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateUnlocked {
			return "", errors.New("encrypted notebook key was not ready for internal initialization")
		}
		if acquireErr := AcquireEncryptedBoxOperation(boxID); acquireErr == nil {
			ReleaseEncryptedBoxOperation(boxID)
			return "", errors.New("encrypted notebook admitted an external operation during initialization")
		}
		return "", expectedInitializationError
	})
	if !errors.Is(err, expectedInitializationError) {
		t.Fatalf("unexpected encrypted notebook initialization error: %v", err)
	}
	if failedBoxID == "" {
		t.Fatal("failed encrypted notebook ID was not captured")
	}
	if _, statErr := os.Stat(filepath.Join(util.DataDir, failedBoxID)); !os.IsNotExist(statErr) {
		t.Fatalf("failed encrypted notebook directory was not removed: %v", statErr)
	}
	if IsBoxUnlocked(failedBoxID) {
		t.Fatal("failed encrypted notebook retained its DEK")
	}
	if sql.GetEncryptedDB(failedBoxID) != nil {
		t.Fatal("failed encrypted notebook retained its content database")
	}
	for _, openedBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
		if openedBoxID == failedBoxID {
			t.Fatal("failed encrypted notebook retained its block tree database")
		}
	}
	if _, ok := encryptedBoxLifecycles.Load(failedBoxID); ok {
		t.Fatal("failed encrypted notebook retained its lifecycle")
	}
	if _, ok := boxLastAccess.Load(failedBoxID); ok {
		t.Fatal("failed encrypted notebook retained its access timestamp")
	}
	if isRuntimeEncryptedBox(failedBoxID) {
		t.Fatal("failed encrypted notebook retained its runtime identity")
	}
}
