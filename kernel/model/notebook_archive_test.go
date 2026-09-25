package model

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func notebookArchiveTestWorkspace(t *testing.T) {
	t.Helper()
	oldConf := Conf
	oldWorkspace, oldData, oldHistory, oldConfig, oldTemp, oldRepo := util.WorkspaceDir, util.DataDir, util.HistoryDir, util.ConfDir, util.TempDir, util.RepoDir
	t.Cleanup(func() {
		Conf = oldConf
		util.WorkspaceDir, util.DataDir, util.HistoryDir, util.ConfDir, util.TempDir, util.RepoDir = oldWorkspace, oldData, oldHistory, oldConfig, oldTemp, oldRepo
	})
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.HistoryDir, util.ConfDir, util.TempDir, util.RepoDir = filepath.Join(root, "data"), filepath.Join(root, "history"), filepath.Join(root, "conf"), filepath.Join(root, "temp"), filepath.Join(root, "repo")
	for _, dir := range []string{util.DataDir, util.HistoryDir, util.ConfDir, util.TempDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	Conf.Sync.Enabled = false
}

func notebookArchiveTestBox(t *testing.T, boxID string, kek []byte) []byte {
	t.Helper()
	crypt, dek, err := WrapNewDEK(boxID, kek)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.Closed, boxConf.BoxCrypt = true, true, crypt
	if err = encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(util.DataDir, boxID)
	if err = os.MkdirAll(filepath.Join(directory, ".siyuan"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]interface{}{"conf.json": boxConf, notebookCryptoBackupFilename: crypt} {
		data, _ := json.Marshal(value)
		if err = os.WriteFile(filepath.Join(directory, ".siyuan", name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	fileKey := util.DeriveSubKey(dek, "siyuan/file")
	defer zeroAndClear(fileKey)
	name := boxID + ".sy"
	aad, _ := filesys.SyAAD(boxID, name)
	data, err := util.EncryptWithAAD(fileKey, []byte(`{"ID":"`+boxID+`","Spec":"2","Type":"NodeDocument"}`), []byte(aad))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, name), data, 0600); err != nil {
		t.Fatal(err)
	}
	asset, err := EncryptAsset(boxID, "resource.bin", "source.bin", dek, []byte("protected asset"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(directory, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, "assets", "resource.bin"), asset, 0600); err != nil {
		t.Fatal(err)
	}
	legacy := legacyEncryptedAssetFixture(t, boxID, "legacy.bin", "legacy.bin", dek, []byte("legacy asset"))
	if err = os.WriteFile(filepath.Join(directory, "assets", "legacy.bin"), legacy, 0600); err != nil {
		t.Fatal(err)
	}
	avKey := util.DeriveSubKey(dek, "siyuan/av")
	defer zeroAndClear(avKey)
	if err = os.MkdirAll(filepath.Join(directory, "storage", "av"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, avID := range []string{boxID, "mirror", "relation"} {
		aad := "siyuan:av:" + boxID + ":" + avID
		if avID == "mirror" || avID == "relation" {
			aad = "siyuan:av-" + avID + ":" + boxID
		}
		definition, encryptErr := util.EncryptWithAAD(avKey, []byte(`{"id":"`+avID+`","spec":8}`), []byte(aad))
		if encryptErr != nil {
			t.Fatal(encryptErr)
		}
		if err = os.WriteFile(filepath.Join(directory, "storage", "av", avID+".json"), definition, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		forgetRuntimeEncryptedBox(boxID)
		forgetRuntimeNormalBox(boxID)
		removeEncryptedBoxLifecycle(boxID)
	})
	return data
}

func TestNotebookArchivePartialRemovalAndAuthenticatedRecovery(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("archive-password"); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK("archive-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	ids := []string{"20260925120001-archive", "20260925120002-archive", "20260925120003-archive", "20260925120004-archive", "20260925120005-archive"}
	original := map[string][]byte{}
	for _, id := range ids {
		original[id] = notebookArchiveTestBox(t, id, kek)
	}
	oldSalt := append([]byte(nil), Conf.NotebookCrypto.MasterSalt...)
	archiveID, _, err := PrepareNotebookArchive(ids[:3])
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	archivePath := filepath.Join(directory, "archive.zip")
	if err = CommitNotebookArchive(archiveID, false); !errors.Is(err, ErrNotebookArchiveInvalid) {
		t.Fatalf("missing save confirmation: %v", err)
	}
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatalf("commit retry: %v", err)
	}
	for i, id := range ids {
		_, err = os.Stat(filepath.Join(util.DataDir, id))
		if (i < 3) != os.IsNotExist(err) {
			t.Fatalf("unexpected presence for %s: %v", id, err)
		}
	}
	if !bytes.Equal(oldSalt, Conf.NotebookCrypto.MasterSalt) {
		t.Fatal("partial removal changed master salt")
	}
	if err = DisableEncryptedNotebook(); err == nil {
		t.Fatal("disabled with two remaining notebooks")
	}
	if err = ImportNotebookArchive(archivePath, "archive-password", nil); !errors.Is(err, ErrNotebookArchiveConfigured) {
		t.Fatalf("import overwrote configured workspace: %v", err)
	}
	t.Run("restore in independent workspace", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(archivePath, "wrong", nil); !errors.Is(err, ErrNotebookArchiveAuthentication) {
			t.Fatalf("wrong password: %v", err)
		}
		entries, _ := os.ReadDir(util.DataDir)
		if len(entries) != 0 || Conf.NotebookCrypto.Enabled {
			t.Fatal("failed authentication mutated target")
		}
		if err := ImportNotebookArchive(archivePath, "archive-password", nil); err != nil {
			t.Fatal(err)
		}
		for _, id := range ids[:3] {
			data, err := os.ReadFile(filepath.Join(util.DataDir, id, id+".sy"))
			if err != nil || !bytes.Equal(data, original[id]) {
				t.Fatalf("ciphertext changed: %s %v", id, err)
			}
			if IsBoxUnlocked(id) {
				t.Fatal("recovery exposed plaintext")
			}
		}
		key, err := deriveKEK("archive-password")
		defer zeroAndClear(key)
		if err != nil {
			t.Fatalf("restored key cannot authenticate: %v", err)
		}
	})
}

func TestNotebookArchiveRejectsChangedSourcesAndRollsBackInterruptedMove(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("archive-password"); err != nil {
		t.Fatal(err)
	}
	kek, _ := deriveKEK("archive-password")
	defer zeroAndClear(kek)
	id := "20260925120006-archive"
	original := notebookArchiveTestBox(t, id, kek)
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(util.DataDir, id)
	if err = os.WriteFile(filepath.Join(source, id+".sy"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = CommitNotebookArchive(archiveID, true); !errors.Is(err, ErrNotebookArchiveChanged) {
		t.Fatalf("accepted stale archive: %v", err)
	}
	if err = os.WriteFile(filepath.Join(source, id+".sy"), original, 0600); err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	operation := &notebookArchiveOperation{State: "committing", Roots: []string{"data/" + id}}
	if err = writeNotebookArchiveOperation(directory, operation); err != nil {
		t.Fatal(err)
	}
	removed := filepath.Join(directory, "removed", "data", id)
	if err = os.MkdirAll(filepath.Dir(removed), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(source, removed); err != nil {
		t.Fatal(err)
	}
	if err = checkPendingNotebookArchives(); !errors.Is(err, ErrNotebookArchiveBusy) {
		t.Fatalf("pending transaction allowed key changes: %v", err)
	}
	if err = ChangeMasterPassword("archive-password", "new-password"); !errors.Is(err, ErrNotebookArchiveBusy) {
		t.Fatalf("pending transaction allowed password changes: %v", err)
	}
	if err = recoverNotebookArchiveOperations(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(source, id+".sy"))
	if err != nil || !bytes.Equal(data, original) {
		t.Fatalf("crash recovery lost ciphertext: %v", err)
	}
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
}

func TestNotebookArchiveMissingBackupAndLaterRecoveredKey(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("archive-password"); err != nil {
		t.Fatal(err)
	}
	kek, _ := deriveKEK("archive-password")
	defer zeroAndClear(kek)
	id := "20260925120007-archive"
	notebookArchiveTestBox(t, id, kek)
	backup, err := os.ReadFile(dataCryptoBackupPath())
	if err != nil {
		t.Fatal(err)
	}
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.NotebookCrypto.MasterSalt = []byte("partial old configuration")
	if err = os.Remove(filepath.Join(util.ConfDir, "conf.json")); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(dataCryptoBackupPath()); err != nil {
		t.Fatal(err)
	}
	if state := NotebookCryptoLifecycleState(false); state != NotebookCryptoStateRecoveryRequired {
		t.Fatalf("partial key material did not expose the recovery state: %s", state)
	}
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	t.Run("recover after finding backup", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(filepath.Join(directory, "archive.zip"), "archive-password", nil); !errors.Is(err, ErrNotebookArchiveAuthentication) {
			t.Fatalf("missing key was fabricated: %v", err)
		}
		if err := ImportNotebookArchive(filepath.Join(directory, "archive.zip"), "archive-password", backup); err != nil {
			t.Fatal(err)
		}
	})
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
	if err = DisableEncryptedNotebook(); err != nil {
		t.Fatalf("cannot retire incomplete key configuration after archiving: %v", err)
	}
	if err = EnableEncryptedNotebook("new-password"); err != nil {
		t.Fatalf("cannot enable independent keys after archiving: %v", err)
	}
}

func TestNotebookArchiveResetDoesNotRetainOldHistoryKeys(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("first-password"); err != nil {
		t.Fatal(err)
	}
	if err := ChangeMasterPassword("first-password", "second-password"); err != nil {
		t.Fatal(err)
	}
	if len(Conf.NotebookCrypto.HistoryKEKs) == 0 {
		t.Fatal("missing history-key fixture")
	}
	if err := DisableEncryptedNotebook(); err != nil {
		t.Fatal(err)
	}
	if len(Conf.NotebookCrypto.HistoryKEKs) != 0 {
		t.Fatal("old wrapped keys survived reset")
	}
	if err := EnableEncryptedNotebook("new-password"); err != nil {
		t.Fatal(err)
	}
	key, err := deriveKEK("new-password")
	defer zeroAndClear(key)
	if err != nil {
		t.Fatal(err)
	}
}

func TestNotebookArchiveRejectsTraversalAndUnknownVersion(t *testing.T) {
	for _, name := range []string{"../outside", "/outside", "data/../outside", "C:/outside", "data\\outside", "data/file.", "data/CON"} {
		if archiveRelativePath(name) {
			t.Fatalf("accepted unsafe path %q", name)
		}
	}
	manifest := &notebookArchiveManifest{Format: notebookArchiveFormat, Version: 2, ID: "20260925120008-archive", Notebooks: []string{"20260925120007-archive"}}
	if validateNotebookArchiveManifest(manifest) == nil {
		t.Fatal("accepted unknown archive version")
	}
	archivePath := filepath.Join(t.TempDir(), "traversal.zip")
	file, _ := os.Create(archivePath)
	writer := zip.NewWriter(file)
	entry, _ := writer.Create("../outside")
	entry.Write([]byte("data"))
	writer.Close()
	file.Close()
	if _, err := readNotebookArchive(archivePath, t.TempDir()); !errors.Is(err, ErrNotebookArchiveInvalid) {
		t.Fatalf("unsafe extraction: %v", err)
	}
}

func TestNotebookArchiveHistoryAndRepositorySnapshots(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	if err := EnableEncryptedNotebook("snapshot-password"); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK("snapshot-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	id := "20260925120101-archive"
	notebookArchiveTestBox(t, id, kek)
	historyRoot := filepath.Join(util.HistoryDir, "2026-09-25-120101-delete")
	if err = archiveWalk(filepath.Join(util.DataDir, id), func(name, source string) error {
		return archiveCopyFile(source, filepath.Join(historyRoot, id, filepath.FromSlash(name)))
	}); err != nil {
		t.Fatal(err)
	}
	ordinaryHistory := filepath.Join(historyRoot, "20260925120102-normalx", "note.txt")
	if err = os.MkdirAll(filepath.Dir(ordinaryHistory), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(ordinaryHistory, []byte("ordinary history"), 0600); err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("encrypted snapshot", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	archivePath := filepath.Join(directory, "archive.zip")
	manifest, err := readNotebookArchive(archivePath, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := manifest.Files["snapshots/"+index.ID+"/"+id+"/"+id+".sy"]; !exists {
		t.Fatal("repository ciphertext missing from archive")
	}
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(historyRoot, id)); !os.IsNotExist(err) {
		t.Fatalf("selected history remains: %v", err)
	}
	if _, err = os.Stat(ordinaryHistory); err != nil {
		t.Fatalf("ordinary history removed: %v", err)
	}
	if _, err = repo.GetIndex(index.ID); err != nil {
		t.Fatalf("repository snapshot removed: %v", err)
	}
	if err = DisableEncryptedNotebook(); err != nil {
		t.Fatalf("archived dependencies still block reset: %v", err)
	}
	if err = EnableEncryptedNotebook("new-key-domain"); err != nil {
		t.Fatal(err)
	}
	if err = DisableEncryptedNotebook(); err != nil {
		t.Fatalf("archived snapshots blocked an unrelated key domain: %v", err)
	}
	t.Run("restore current notebook and both histories", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(archivePath, "snapshot-password", nil); err != nil {
			t.Fatal(err)
		}
		histories, err := encryptedNotebookHistoryBoxDirs()
		if err != nil || len(histories) != 2 {
			t.Fatalf("history recovery incomplete: %v %v", histories, err)
		}
		if _, err = os.Stat(filepath.Join(util.DataDir, id)); err != nil {
			t.Fatal(err)
		}
	})
}

func TestNotebookArchiveRejectsCiphertextWithRecomputedArchiveChecksum(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("archive-password"); err != nil {
		t.Fatal(err)
	}
	kek, _ := deriveKEK("archive-password")
	defer zeroAndClear(kek)
	id := "20260925120103-archive"
	notebookArchiveTestBox(t, id, kek)
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	tampered := t.TempDir()
	manifest, err := readNotebookArchive(filepath.Join(directory, "archive.zip"), filepath.Join(tampered, "payload"))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(tampered, "payload", "data", id, id+".sy")
	data, _ := os.ReadFile(file)
	data[len(data)-1] ^= 1
	if err = os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = writeNotebookArchive(tampered, manifest); err != nil {
		t.Fatal(err)
	}
	t.Run("authentication is required beyond zip checksums", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(filepath.Join(tampered, "archive.zip"), "archive-password", nil); !errors.Is(err, ErrNotebookArchiveAuthentication) {
			t.Fatalf("unauthenticated ciphertext accepted: %v", err)
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, id)); !os.IsNotExist(err) {
			t.Fatal("failed import published ciphertext")
		}
	})
}

func TestNotebookArchiveInterruptedImportRollsBack(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	id := "20260925120104-archive"
	directory, _ := notebookArchiveDirectory("20260925120105-archive")
	root := "data/" + id
	operation := &notebookArchiveOperation{State: "importing", Roots: []string{root}}
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeNotebookArchiveOperation(directory, operation); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(util.DataDir, id), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, id, "source"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(dataCryptoBackupPath()), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{dataCryptoBackupPath(), filepath.Join(directory, "import-key.json")} {
		if err := os.WriteFile(name, []byte("recovery material"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := recoverNotebookArchiveOperations(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, id)); !os.IsNotExist(err) {
		t.Fatal("partial import remained visible")
	}
	if _, err := os.Stat(dataCryptoBackupPath()); !os.IsNotExist(err) {
		t.Fatal("partial import left active key backup")
	}
	data, err := os.ReadFile(filepath.Join(directory, "install", "data", id, "source"))
	if err != nil || string(data) != "original" {
		t.Fatalf("recovery destroyed original bytes: %v", err)
	}
}

func TestNotebookArchiveRecoversDocumentHistoryWithoutSeparateEnvelope(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("history-password"); err != nil {
		t.Fatal(err)
	}
	kek, _ := deriveKEK("history-password")
	defer zeroAndClear(kek)
	id := "20260925120106-archive"
	notebookArchiveTestBox(t, id, kek)
	history := filepath.Join(util.HistoryDir, "2026-09-25-120106-update", id)
	if err := archiveWalk(filepath.Join(util.DataDir, id), func(name, source string) error {
		if strings.HasPrefix(name, ".siyuan/") {
			return nil
		}
		return archiveCopyFile(source, filepath.Join(history, filepath.FromSlash(name)))
	}); err != nil {
		t.Fatal(err)
	}
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	archivePath := filepath.Join(directory, "archive.zip")
	t.Run("restore ordinary document and asset history", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(archivePath, "history-password", nil); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{id + ".sy", "assets/resource.bin", "assets/legacy.bin", "storage/av/" + id + ".json"} {
			if _, err := os.Stat(filepath.Join(util.HistoryDir, "2026-09-25-120106-update", id, filepath.FromSlash(name))); err != nil {
				t.Fatal(err)
			}
		}
	})
}

func TestNotebookArchiveHistoryOnlyAndTargetCollisions(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("history-password"); err != nil {
		t.Fatal(err)
	}
	kek, _ := deriveKEK("history-password")
	defer zeroAndClear(kek)
	id := "20260925120107-archive"
	notebookArchiveTestBox(t, id, kek)
	history := filepath.Join(util.HistoryDir, "2026-09-25-120107-delete", id)
	if err := os.MkdirAll(filepath.Dir(history), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(util.DataDir, id), history); err != nil {
		t.Fatal(err)
	}
	candidates, err := ListNotebookArchiveCandidates()
	if err != nil || len(candidates) != 1 || candidates[0].Current {
		t.Fatalf("missing history-only candidate: %v %v", candidates, err)
	}
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	archivePath := filepath.Join(directory, "archive.zip")
	if err = CommitNotebookArchive(archiveID, true); err != nil {
		t.Fatal(err)
	}
	if err = DisableEncryptedNotebook(); err != nil {
		t.Fatal(err)
	}
	t.Run("history remains unmounted", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(archivePath, "history-password", nil); err != nil {
			t.Fatal(err)
		}
		if ids, err := listAllEncryptedBoxIDs(); err != nil || len(ids) != 0 {
			t.Fatalf("history became a current notebook: %v %v", ids, err)
		}
		if histories, err := encryptedNotebookHistoryBoxDirs(); err != nil || len(histories) != 1 {
			t.Fatalf("history missing: %v %v", histories, err)
		}
	})
	t.Run("existing history is never overwritten", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		destination := filepath.Join(util.HistoryDir, "2026-09-25-120107-delete", id, "ordinary.txt")
		if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(destination, []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := ImportNotebookArchive(archivePath, "history-password", nil); !errors.Is(err, ErrNotebookArchiveConfigured) {
			t.Fatalf("accepted colliding history: %v", err)
		}
		if data, err := os.ReadFile(destination); err != nil || string(data) != "keep" {
			t.Fatalf("overwrote target: %v", err)
		}
	})
}

func TestNotebookArchiveDownloadsDeferredEncryptedAssets(t *testing.T) {
	full, partial, fullData := prepareAssetDownloadRepoTest(t)
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	if err := EnableEncryptedNotebook("deferred-password"); err != nil {
		t.Fatal(err)
	}
	kek, _ := deriveKEK("deferred-password")
	defer zeroAndClear(kek)
	id := "20260925120108-archive"
	localData := util.DataDir
	util.DataDir = fullData
	func() {
		defer func() { util.DataDir = localData }()
		notebookArchiveTestBox(t, id, kek)
	}()
	if err := archiveCopyFile(dataCryptoBackupPath(), filepath.Join(fullData, ".siyuan", "data-crypto-backup.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := full.Index("encrypted assets", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	asset := filepath.Join(localData, id, "assets", "legacy.bin")
	if _, err := os.Stat(asset); !os.IsNotExist(err) {
		t.Fatalf("fixture asset was not deferred: %v", err)
	}
	archiveID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	manifest, err := readNotebookArchive(filepath.Join(directory, "archive.zip"), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := manifest.Files["data/"+id+"/assets/legacy.bin"]; !exists {
		t.Fatal("deferred asset missing from archive")
	}
	data, err := os.ReadFile(asset)
	expected, expectedErr := os.ReadFile(filepath.Join(fullData, id, "assets", "legacy.bin"))
	if err != nil || expectedErr != nil || !bytes.Equal(data, expected) {
		t.Fatalf("download changed ciphertext: %v %v", err, expectedErr)
	}
}
