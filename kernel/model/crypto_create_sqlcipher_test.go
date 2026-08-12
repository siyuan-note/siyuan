// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
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
	Conf.FileTree = conf.NewFileTree()
	*Conf.FileTree.BoxDocEnabled = true
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
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
