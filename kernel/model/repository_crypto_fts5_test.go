// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPasswordMigrationDownloadRecoversMissingNotebook(t *testing.T) {
	const childEnv = "SIYUAN_TEST_PASSWORD_DOWNLOAD_RECOVERY"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPasswordMigrationDownloadRecoversMissingNotebook$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
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
	if err := EnableEncryptedNotebook("old-password"); err != nil {
		t.Fatal(err)
	}
	oldKey, err := deriveKEK("old-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(oldKey)
	const boxID = "20261027000000-recover"
	original := notebookArchiveTestBox(t, boxID, oldKey)
	oldVerifier := bytes.Clone(currentNotebookCrypto().KEKVerifier)
	oldBackup, err := os.ReadFile(dataCryptoBackupPath())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = CreateRepoSnapshotWithFullCheck("coherent old-password state", true); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SyncUpload(nil); err != nil {
		t.Fatal(err)
	}
	if err = ChangeMasterPassword("old-password", "new-password"); err != nil {
		t.Fatal(err)
	}
	nc := currentNotebookCrypto()
	crypt, err := GetBoxEncryption(boxID)
	if err != nil {
		t.Fatal(err)
	}
	params, _ := json.Marshal(nc.KDFParams)
	manifest := &masterPasswordMigration{OldVerifier: oldVerifier, NewVerifier: nc.KEKVerifier,
		NewVerifierNonce: nc.VerifierNonce, NewKDFParams: params, NewHistoryKEKs: nc.HistoryKEKs,
		Boxes: []migrationBoxEntry{{BoxID: boxID, NewSpec: crypt.Spec, NewWrappedDEK: crypt.WrappedDEK,
			NewWrapNonce: crypt.WrapNonce, Metadata: crypt.Metadata}}}
	// Reproduce an interrupted change before the global recovery backup was replaced.
	if err = writeMasterPasswordMigration(manifest); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(dataCryptoBackupPath(), oldBackup, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(filepath.Join(util.DataDir, boxID), filepath.Join(util.WorkspaceDir, "retained-notebook")); err != nil {
		t.Fatal(err)
	}
	lockSync()
	err = syncRepoDownload()
	unlockSync()
	if err != nil {
		t.Fatal(err)
	}
	if pending, _ := MasterPasswordMigrationStatus(); !pending {
		t.Fatal("download discarded the recovery manifest before password authentication")
	}
	if data, readErr := os.ReadFile(filepath.Join(util.DataDir, boxID, boxID+".sy")); readErr != nil || !bytes.Equal(data, original) {
		t.Fatalf("download did not recover the original ciphertext: %v", readErr)
	}
	key, err := deriveKEK("new-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(key)
	dek, _, err := decryptBoxCrypt(boxID, key)
	zeroAndClear(dek)
	if err != nil {
		t.Fatalf("new password could not recover downloaded notebook: %v", err)
	}
	if pending, _ := MasterPasswordMigrationStatus(); pending {
		t.Fatal("authenticated recovery did not complete migration")
	}
	if _, _, err = CreateRepoSnapshotWithFullCheck("recovered", true); err != nil {
		t.Fatal(err)
	}
	lockSync()
	err = syncRepoUpload()
	unlockSync()
	if err != nil {
		t.Fatalf("complete recovered state could not upload: %v", err)
	}
	backup, err := loadNotebookCryptoBackup()
	if err != nil || !verifyKEKMAC(backup, key) {
		t.Fatalf("recovery did not publish authenticated backup: %v", err)
	}
}
