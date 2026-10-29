// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestPasswordChangeSerializesRepositoryAccess(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	if err := EnableEncryptedNotebook("old-password"); err != nil {
		t.Fatal(err)
	}
	filelock.Lock(masterPasswordMigrationPath())
	locked := true
	defer func() {
		if locked {
			filelock.Unlock(masterPasswordMigrationPath())
		}
	}()
	changed := make(chan error, 1)
	go func() { changed <- ChangeMasterPassword("old-password", "new-password") }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if !syncLock.TryLock() {
			break
		}
		syncLock.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("password change did not exclude synchronization")
		}
		time.Sleep(time.Millisecond)
	}
	snapshot := make(chan error, 1)
	go func() { _, _, err := CreateRepoSnapshotWithFullCheck("after password change", true); snapshot <- err }()
	select {
	case err := <-snapshot:
		t.Fatalf("snapshot sampled an active password change: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	filelock.Unlock(masterPasswordMigrationPath())
	locked = false
	if err := <-changed; err != nil {
		t.Fatal(err)
	}
	if err := <-snapshot; err != nil {
		t.Fatal(err)
	}
	index, err := repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	var backup conf.NotebookCrypto
	if err = json.Unmarshal([]byte(repoSnapshotTestContent(t, repo, index.ID, "/.siyuan/data-crypto-backup.json")), &backup); err != nil {
		t.Fatal(err)
	}
	key, err := deriveKEK("new-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(key)
	if !verifyKEKMAC(&backup, key) {
		t.Fatal("snapshot did not contain the completed authenticated key backup")
	}
}

func TestPasswordMigrationBlocksRepositoryPublication(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	before, err := repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	remoteBefore, err := repo.GetCloudLatestFast(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{`{"boxes":[]}`, `{"boxes":`} {
		if err = os.MkdirAll(filepath.Dir(masterPasswordMigrationPath()), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(masterPasswordMigrationPath(), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err = CreateRepoSnapshot("must not publish"); !errors.Is(err, errMasterPasswordMigrationPending) {
			t.Fatalf("manual snapshot accepted pending migration: %v", err)
		}
		lockSync()
		uploadErr := syncRepoUpload()
		_, fullErr := syncRepoWithContext(context.Background(), false, true)
		unlockSync()
		if !errors.Is(uploadErr, errMasterPasswordMigrationPending) || !errors.Is(fullErr, errMasterPasswordMigrationPending) {
			t.Fatalf("pending migration was uploaded: upload=%v full=%v", uploadErr, fullErr)
		}
		after, readErr := repo.Latest()
		if readErr != nil || after.ID != before.ID {
			t.Fatalf("publication gate changed latest index: %v", readErr)
		}
		if data, readErr := os.ReadFile(masterPasswordMigrationPath()); readErr != nil || string(data) != content {
			t.Fatalf("publication gate changed recovery material: %v", readErr)
		}
		for _, plan := range []*dejavu.CheckoutPlan{
			{Upserts: []*entity.File{{Path: "/.siyuan/master-password-migration.json"}}},
			{Removes: []*entity.File{{Path: "/.siyuan/master-password-migration.json"}}},
		} {
			if err = documentAddressingPreflight(repo)(plan); !errors.Is(err, errMasterPasswordMigrationPending) {
				t.Fatalf("checkout accepted replacement of local recovery material: %v", err)
			}
		}
		remoteAfter, readErr := repo.GetCloudLatestFast(nil)
		if readErr != nil || remoteAfter.ID != remoteBefore.ID {
			t.Fatalf("publication gate changed cloud latest: %v", readErr)
		}
	}
}
