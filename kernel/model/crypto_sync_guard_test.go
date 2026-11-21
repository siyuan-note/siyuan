// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDisableEncryptedNotebookSyncGuard(t *testing.T) {
	for _, mode := range []string{"active", "paused", "cleared", "legacy-ref"} {
		t.Run(mode, func(t *testing.T) {
			notebookArchiveTestWorkspace(t)
			if err := EnableEncryptedNotebook("synthetic-password"); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(dataCryptoBackupPath())
			if err != nil {
				t.Fatal(err)
			}
			confPath := filepath.Join(util.ConfDir, "conf.json")
			beforeConf, err := os.ReadFile(confPath)
			if err != nil {
				t.Fatal(err)
			}
			original := Conf.NotebookCrypto
			switch mode {
			case "active":
				Conf.Sync.Load().Enabled = true
			case "paused":
				Conf.Sync.Load().Synced = 1
			case "cleared":
				Conf.Sync.Load().Configured = true
			case "legacy-ref":
				dir := filepath.Join(util.RepoDir, "refs")
				if err = os.MkdirAll(dir, 0700); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(dir, "latest-sync"), []byte("synthetic"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err = DisableEncryptedNotebook(); err == nil {
				t.Fatal("configured sync allowed destructive disable")
			}
			after, err := os.ReadFile(dataCryptoBackupPath())
			if err != nil {
				t.Fatal(err)
			}
			afterConf, err := os.ReadFile(confPath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(beforeConf, afterConf) {
				t.Fatal("rejected disable changed persisted configuration")
			}
			if !bytes.Equal(before, after) || Conf.NotebookCrypto != original {
				t.Fatal("rejected disable changed key material")
			}
		})
	}
}

func TestSyncAssociationSurvivesSettingsChanges(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	Conf.Sync.Load().Enabled = true
	UpdateSyncConf(func(s *conf.Sync) { s.Enabled = false })
	if !Conf.Sync.Load().Configured {
		t.Fatal("pause lost legacy enabled evidence")
	}
	UpdateSyncConf(func(s *conf.Sync) { s.Configured = false; s.Synced = 0; s.LastResult = 0 })
	if !Conf.Sync.Load().Configured {
		t.Fatal("settings reset erased association")
	}
	Conf.Sync.Store(conf.NewSync())
	Conf.Sync.Load().Provider = conf.ProviderLocal
	Conf.Sync.Load().Local = &conf.Local{Endpoint: t.TempDir()}
	if err := persistClearedSyncProviderConfig(conf.ProviderLocal); err != nil {
		t.Fatal(err)
	}
	if !Conf.Sync.Load().Configured || Conf.Sync.Load().Local.Endpoint != "" {
		t.Fatal("clear lost association")
	}
}

func TestLegacySyncAssociationSurvivesRepoReplacement(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	dir := filepath.Join(util.RepoDir, "refs")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	ref := filepath.Join(dir, "latest-sync")
	if err := os.WriteFile(ref, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	enrollLegacySyncAssociation(Conf)
	Conf.Save()
	if err := os.Remove(ref); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		Sync *conf.Sync `json:"sync"`
	}
	if err = json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	Conf.Sync.Store(saved.Sync)
	if !EncryptedNotebookDisableBlockedBySync() {
		t.Fatal("legacy association lost after repo replacement and reload")
	}
}

func TestNotebookArchiveLocalAllowsRemovalAndNewKeys(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	Conf.System.Store(conf.NewSystem())
	Conf.Repo.Store(conf.NewRepo())
	Conf.Repo.Load().Key = []byte("0123456789abcdef0123456789abcdef")
	if err := EnableEncryptedNotebook("original-password"); err != nil {
		t.Fatal(err)
	}
	oldSalt := bytes.Clone(Conf.NotebookCrypto.MasterSalt)
	kek, err := deriveKEK("original-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	id := "20260925120101-archive"
	notebookArchiveTestBox(t, id, kek)
	repo, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("local encrypted snapshot", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(util.RepoDir, "refs", "latest-sync")); !os.IsNotExist(err) {
		t.Fatalf("local snapshot unexpectedly left sync evidence: %v", err)
	}

	if EncryptedNotebookDisableBlockedBySync() {
		t.Fatal("workspace without a sync association was blocked")
	}
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, err := notebookArchiveDirectory(archiveID)
	if err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(directory, "archive.zip")
	manifest, err := readNotebookArchive(archivePath, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := manifest.Files["snapshots/"+index.ID+"/"+id+"/"+id+".sy"]; !exists {
		t.Fatal("local repository ciphertext missing from archive")
	}
	before, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, id)); !os.IsNotExist(err) {
		t.Fatalf("confirmed archive did not remove selected notebook: %v", err)
	}
	if err = DisableEncryptedNotebook(); err != nil {
		t.Fatalf("cannot retire local keys after archiving: %v", err)
	}
	if err = EnableEncryptedNotebook("new-password"); err != nil {
		t.Fatalf("cannot enable independent local keys after archiving: %v", err)
	}
	newSalt := Conf.NotebookCrypto.MasterSalt
	if len(newSalt) == 0 || bytes.Equal(newSalt, oldSalt) {
		t.Fatal("reenabling encryption did not create fresh key material")
	}
	if err = DisableEncryptedNotebook(); err != nil {
		t.Fatalf("archived snapshot incorrectly blocked retiring new local keys: %v", err)
	}
	if _, err = repo.GetIndex(index.ID); err != nil {
		t.Fatalf("local repository snapshot was removed: %v", err)
	}
	after, err := os.ReadFile(archivePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("retiring local keys changed the saved archive: %v", err)
	}
}

func TestNotebookArchiveSyncAllowsRemovalButBlocksDisable(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("synthetic-password"); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK("synthetic-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	id := "20260925120101-archive"
	notebookArchiveTestBox(t, id, kek)
	Conf.Sync.Load().Synced = 1
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, id)); !os.IsNotExist(err) {
		t.Fatalf("confirmed archive did not remove selected notebook: %v", err)
	}
	if err = DisableEncryptedNotebook(); err == nil {
		t.Fatal("archive incorrectly allowed retiring shared keys")
	}
	if _, err = os.Stat(dataCryptoBackupPath()); err != nil {
		t.Fatal(err)
	}
}
