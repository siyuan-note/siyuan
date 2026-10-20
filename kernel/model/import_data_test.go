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

package model

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const dataImportTestID = "20261020180000-importa"

func dataImportTestWorkspace(t *testing.T) []byte {
	t.Helper()
	notebookArchiveTestWorkspace(t)
	editor := conf.NewEditor()
	editor.VirtualBlockRef = false
	editor.GenerateHistoryInterval = 0
	Conf.Editor.Store(editor)
	Conf.FileTree.Store(conf.NewFileTree())
	Conf.Search.Store(conf.NewSearch())
	if err := EnableEncryptedNotebook("import-password"); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK("import-password")
	if err != nil {
		t.Fatal(err)
	}
	notebookArchiveTestBox(t, dataImportTestID, kek)
	return kek
}

func dataImportTestSnapshot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := archiveWalk(util.DataDir, func(name, p string) error {
		return copyDataImportFile(p, filepath.Join(root, filepath.FromSlash(name)))
	}); err != nil {
		t.Fatal(err)
	}
	return root
}

func dataImportTestZip(t *testing.T, root string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "data.zip")
	output, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(output)
	if err = archiveWalk(root, func(name, p string) error {
		entry, createErr := writer.Create("data/" + name)
		if createErr != nil {
			return createErr
		}
		data, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		_, writeErr := entry.Write(data)
		return writeErr
	}); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = output.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func dataImportTestDocument(t *testing.T, root, id string, dek []byte, title string) []byte {
	t.Helper()
	name := id + ".sy"
	aad, err := filesys.SyAAD(dataImportTestID, name)
	if err != nil {
		t.Fatal(err)
	}
	key := util.DeriveSubKey(dek, "siyuan/file")
	defer zeroAndClear(key)
	plain := []byte(`{"ID":"` + id + `","Spec":"2","Type":"NodeDocument","Properties":{"title":"` + title + `"}}`)
	data, err := util.EncryptWithAAD(key, plain, []byte(aad))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, dataImportTestID, name), data, 0600); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestDataImportSkipPreservesNotebookAndKeyBackup(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	before, err := archiveDirectoryFiles(util.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	source := dataImportTestSnapshot(t)
	if err = os.WriteFile(filepath.Join(source, dataImportTestID, dataImportTestID+".sy"), []byte("corrupt source is skipped"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, ".siyuan", "data-crypto-backup.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, ".siyuan", "master-password-migration.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "ordinary.txt"), []byte("imported"), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil || !reflect.DeepEqual(plan.Conflicts, []string{dataImportTestID}) {
		t.Fatalf("prepare: %+v %v", plan, err)
	}
	skipped, err := CommitDataImport(plan.ID, "skip", "")
	if err != nil || !reflect.DeepEqual(skipped, plan.Conflicts) {
		t.Fatalf("skip: %v %v", skipped, err)
	}
	after, err := archiveDirectoryFiles(util.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	for name, expected := range before {
		if after[name] != expected {
			t.Fatalf("skip changed existing file %s", name)
		}
	}
	if _, exists := after["ordinary.txt"]; !exists {
		t.Fatal("ordinary data was not imported")
	}
	if _, err = os.Stat(masterPasswordMigrationPath()); !os.IsNotExist(err) {
		t.Fatal("installed the incoming password migration")
	}
	if err = CancelDataImport(plan.ID); err == nil {
		t.Fatal("cancel deleted committed recovery material")
	}
}

func TestDataImportCanSkipEveryFile(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	source := dataImportTestSnapshot(t)
	before, err := archiveDirectoryFiles(util.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	skipped, err := CommitDataImport(plan.ID, "skip", "")
	if err != nil || !reflect.DeepEqual(skipped, []string{dataImportTestID}) {
		t.Fatalf("all-skipped import failed: %v %v", skipped, err)
	}
	after, err := archiveDirectoryFiles(util.DataDir)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("all-skipped import changed active data: %v", err)
	}
}

func TestDataImportRestoresEncryptedNotebookInUnconfiguredWorkspace(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	source := dataImportTestSnapshot(t)
	if err := os.RemoveAll(filepath.Join(util.DataDir, dataImportTestID)); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(dataCryptoBackupPath()); err != nil {
		t.Fatal(err)
	}
	forgetRuntimeEncryptedBox(dataImportTestID)
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil || len(plan.Conflicts) != 0 || !reflect.DeepEqual(plan.Encrypted, []string{dataImportTestID}) {
		t.Fatalf("unexpected new notebook plan: %+v %v", plan, err)
	}
	if _, err = CommitDataImport(plan.ID, "skip", "import-password"); err != nil {
		t.Fatal(err)
	}
	if !NotebookCryptoEnabled() || IsBoxUnlocked(dataImportTestID) {
		t.Fatal("restored notebook was not configured and locked")
	}
	current, err := deriveKEK("import-password")
	zeroAndClear(current)
	if err != nil {
		t.Fatal(err)
	}
}

func TestDataImportOverwritePreservesLocalFilesAndLocksNotebook(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	crypt, err := GetBoxEncryption(dataImportTestID)
	if err != nil {
		t.Fatal(err)
	}
	dek, err := decryptWrappedDEK(dataImportTestID, crypt, kek)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	source := dataImportTestSnapshot(t)
	imported := dataImportTestDocument(t, source, dataImportTestID, dek, "imported")
	local := dataImportTestDocument(t, util.DataDir, "20261020180001-importb", dek, "local-only")
	prepareUnlockedEncryptedBoxTest(t, dataImportTestID, dek)
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	skipped, err := CommitDataImport(plan.ID, "overwrite", "import-password")
	if err != nil || len(skipped) != 0 {
		t.Fatalf("overwrite: %v %v", skipped, err)
	}
	for name, expected := range map[string][]byte{dataImportTestID + ".sy": imported, "20261020180001-importb.sy": local} {
		actual, readErr := os.ReadFile(filepath.Join(util.DataDir, dataImportTestID, name))
		if readErr != nil || !bytes.Equal(actual, expected) {
			t.Fatalf("unexpected document %s: %v", name, readErr)
		}
	}
	if IsBoxUnlocked(dataImportTestID) || GetEncryptedBoxState(dataImportTestID) != EncryptedBoxStateLocked {
		t.Fatal("overwrite retained an unlocked notebook")
	}
	if err = authenticateNotebookArchiveBox(filepath.Join(util.DataDir, dataImportTestID), dataImportTestID, dek, crypt); err != nil {
		t.Fatalf("documents, legacy/current assets or attribute views failed authentication: %v", err)
	}
}

func TestDataImportPreservesIncompleteRecoveryConfiguration(t *testing.T) {
	for _, kind := range []string{"partial-config", "backup-only"} {
		t.Run(kind, func(t *testing.T) {
			kek := dataImportTestWorkspace(t)
			defer zeroAndClear(kek)
			source := dataImportTestSnapshot(t)
			if err := os.RemoveAll(filepath.Join(util.DataDir, dataImportTestID)); err != nil {
				t.Fatal(err)
			}
			forgetRuntimeEncryptedBox(dataImportTestID)
			if kind == "backup-only" {
				Conf.NotebookCrypto = conf.NewNotebookCrypto()
			} else {
				Conf.NotebookCrypto.Enabled = false
				Conf.NotebookCrypto.Checksum = "incomplete"
			}
			before := currentNotebookCrypto()
			files, err := archiveDirectoryFiles(util.DataDir)
			if err != nil {
				t.Fatal(err)
			}
			plan, err := PrepareDataImport(dataImportTestZip(t, source))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = CommitDataImport(plan.ID, "overwrite", "import-password"); err == nil {
				t.Fatal("replaced recovery material without authenticating the current configuration")
			}
			after, err := archiveDirectoryFiles(util.DataDir)
			if err != nil || !reflect.DeepEqual(files, after) || !reflect.DeepEqual(before, currentNotebookCrypto()) {
				t.Fatalf("failed import changed recovery material: %v", err)
			}
		})
	}
}

func TestDataImportRejectsUnsafeArchives(t *testing.T) {
	for _, names := range [][]string{
		{"data/../outside.txt"},
		{"data/file.txt", "other/file.txt"},
		{"data/file.txt", "data/file.txt"},
		{"data/file.txt", "data/FILE.txt"},
		{"data/link"},
		{"data\\file.txt"},
	} {
		t.Run(strings.Join(names, "+"), func(t *testing.T) {
			notebookArchiveTestWorkspace(t)
			p := filepath.Join(t.TempDir(), "data.zip")
			output, err := os.Create(p)
			if err != nil {
				t.Fatal(err)
			}
			writer := zip.NewWriter(output)
			for _, name := range names {
				header := &zip.FileHeader{Name: name}
				if name == "data/link" {
					header.SetMode(os.ModeSymlink | 0600)
				}
				entry, createErr := writer.CreateHeader(header)
				if createErr != nil {
					t.Fatal(createErr)
				}
				if _, err = entry.Write([]byte("unsafe")); err != nil {
					t.Fatal(err)
				}
			}
			if err = errors.Join(writer.Close(), output.Close()); err != nil {
				t.Fatal(err)
			}
			if _, err = PrepareDataImport(p); err == nil {
				t.Fatal("accepted an unsafe archive")
			}
			files, err := archiveDirectoryFiles(util.DataDir)
			if err != nil || len(files) != 0 {
				t.Fatalf("invalid archive changed active data: %v", err)
			}
		})
	}
}

func TestDataImportOldBackupKeepsCurrentPasswordAndHistoryKeys(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	source := dataImportTestSnapshot(t)
	history := filepath.Join(util.HistoryDir, "2026-10-20-180000-delete", dataImportTestID)
	if err := archiveWalk(filepath.Join(util.DataDir, dataImportTestID), func(name, p string) error {
		return copyDataImportFile(p, filepath.Join(history, filepath.FromSlash(name)))
	}); err != nil {
		t.Fatal(err)
	}
	if err := ChangeMasterPassword("import-password", "current-password"); err != nil {
		t.Fatal(err)
	}
	before := currentNotebookCrypto()
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = CommitDataImport(plan.ID, "overwrite", "current-password"); err != nil {
		t.Fatal(err)
	}
	currentKEK, err := deriveKEK("current-password")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyKEKAgainstEncryptedHistory(currentKEK, currentNotebookCrypto()) {
		zeroAndClear(currentKEK)
		t.Fatal("import orphaned the existing deleted notebook history")
	}
	zeroAndClear(currentKEK)
	if !bytes.Equal(Conf.NotebookCrypto.KEKVerifier, before.KEKVerifier) ||
		!reflect.DeepEqual(Conf.NotebookCrypto.HistoryKEKs, before.HistoryKEKs) {
		t.Fatal("old backup replaced the current password or history keys")
	}
	derived, err := deriveKEK("current-password")
	zeroAndClear(derived)
	if err != nil {
		t.Fatal(err)
	}
	derived, err = deriveKEK("import-password")
	zeroAndClear(derived)
	if err == nil {
		t.Fatal("old password became active again")
	}
}

func TestDataImportBlocksOtherWriteRequestsDuringCommit(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	previousReadonly := util.ReadOnly
	util.ReadOnly = false
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) })
	called := make(chan struct{}, 1)
	engine.POST("/api/test/write", CheckReadonly, func(c *gin.Context) {
		called <- struct{}{}
		c.Status(http.StatusNoContent)
	})
	dataImportAccess.Lock()
	locked := true
	defer func() {
		if locked {
			dataImportAccess.Unlock()
		}
	}()
	done := make(chan struct{})
	go func() {
		engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/test/write", nil))
		close(done)
	}()
	select {
	case <-called:
		t.Fatal("another write entered the import commit")
	case <-time.After(30 * time.Millisecond):
	}
	dataImportAccess.Unlock()
	locked = false
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("write admission was not restored after import")
	}
	if len(called) != 1 {
		t.Fatal("write handler was not invoked exactly once")
	}
}

func TestDataImportAdoptsNewerCompatibleKeyConfiguration(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	previous := dataImportTestSnapshot(t)
	old, err := json.Marshal(currentNotebookCrypto())
	if err != nil {
		t.Fatal(err)
	}
	if err = ChangeMasterPassword("import-password", "new-device-password"); err != nil {
		t.Fatal(err)
	}
	source := dataImportTestSnapshot(t)
	if err = archiveWalk(previous, func(name, p string) error {
		return copyDataImportFile(p, filepath.Join(util.DataDir, filepath.FromSlash(name)))
	}); err != nil {
		t.Fatal(err)
	}
	oldConf := &conf.NotebookCrypto{}
	if err = json.Unmarshal(old, oldConf); err != nil {
		t.Fatal(err)
	}
	Conf.NotebookCrypto = oldConf
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = CommitDataImport(plan.ID, "overwrite", "new-device-password"); err != nil {
		t.Fatal(err)
	}
	current, err := deriveKEK("new-device-password")
	zeroAndClear(current)
	if err != nil {
		t.Fatal(err)
	}
	if len(Conf.NotebookCrypto.HistoryKEKs) == 0 {
		t.Fatal("lost the old key needed by local history")
	}
}

func TestDataImportRejectsInvalidEncryptedContentBeforeOrdinaryWrites(t *testing.T) {
	for _, kind := range []string{"password", "document", "asset", "attribute-view", "different-key", "normal-source"} {
		t.Run(kind, func(t *testing.T) {
			kek := dataImportTestWorkspace(t)
			defer zeroAndClear(kek)
			source := dataImportTestSnapshot(t)
			password := "import-password"
			switch kind {
			case "password":
				password = "wrong"
			case "document":
				if err := os.WriteFile(filepath.Join(source, dataImportTestID, dataImportTestID+".sy"), []byte("broken"), 0600); err != nil {
					t.Fatal(err)
				}
			case "asset":
				if err := os.WriteFile(filepath.Join(source, dataImportTestID, "assets", "resource.bin"), []byte("broken"), 0600); err != nil {
					t.Fatal(err)
				}
			case "attribute-view":
				if err := os.WriteFile(filepath.Join(source, dataImportTestID, "storage", "av", dataImportTestID+".json"), []byte("broken"), 0600); err != nil {
					t.Fatal(err)
				}
			case "different-key":
				active := util.DataDir
				util.DataDir = source
				notebookArchiveTestBox(t, dataImportTestID, kek)
				util.DataDir = active
			case "normal-source":
				p := filepath.Join(source, dataImportTestID, ".siyuan", "conf.json")
				if err := writeDataImportJSON(p, conf.NewBoxConf()); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(filepath.Join(filepath.Dir(p), notebookCryptoBackupFilename)); err != nil {
					t.Fatal(err)
				}
				// 普通来源不含密文载荷；只保留同 ID 的普通配置来验证反向边界保护。
				if err := os.Remove(filepath.Join(source, dataImportTestID, dataImportTestID+".sy")); err != nil {
					t.Fatal(err)
				}
				if err := os.RemoveAll(filepath.Join(source, dataImportTestID, "assets")); err != nil {
					t.Fatal(err)
				}
				if err := os.RemoveAll(filepath.Join(source, dataImportTestID, "storage")); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(source, "ordinary.txt"), []byte("must not install"), 0600); err != nil {
				t.Fatal(err)
			}
			before, err := archiveDirectoryFiles(util.DataDir)
			if err != nil {
				t.Fatal(err)
			}
			plan, err := PrepareDataImport(dataImportTestZip(t, source))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = CommitDataImport(plan.ID, "overwrite", password); err == nil {
				t.Fatal("accepted invalid encrypted data")
			}
			after, err := archiveDirectoryFiles(util.DataDir)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("failed preflight changed data: %v", err)
			}
		})
	}
}

func TestDataImportCancelChangesAndExpiration(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "ordinary.txt"), []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := dataImportDirectory(plan.ID)
	if err = os.WriteFile(filepath.Join(directory, "incoming", "ordinary.txt"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = CommitDataImport(plan.ID, "skip", ""); err == nil {
		t.Fatal("accepted changed staging files")
	}
	if err = CancelDataImport(plan.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(directory); !os.IsNotExist(err) {
		t.Fatal("cancel retained staging files")
	}
	plan, err = PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	directory, stage, err := loadDataImportStage(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	stage.Created = time.Now().Add(-time.Hour).Unix()
	if err = writeDataImportJSON(filepath.Join(directory, "stage.json"), stage); err != nil {
		t.Fatal(err)
	}
	if _, err = CommitDataImport(plan.ID, "overwrite", ""); err == nil {
		t.Fatal("accepted expired preflight")
	}
}

func TestDataImportTransactionFailureAndRestartRecovery(t *testing.T) {
	for _, crash := range []bool{false, true} {
		t.Run(map[bool]string{false: "write failure", true: "interruption"}[crash], func(t *testing.T) {
			notebookArchiveTestWorkspace(t)
			directory, _ := dataImportDirectory("20261020180002-importc")
			install := filepath.Join(directory, "install")
			for name, content := range map[string]string{"a.txt": "new", "new/b.txt": "new"} {
				if err := writeDataImportBytes(filepath.Join(install, filepath.FromSlash(name)), []byte(content)); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(util.DataDir, "a.txt"), []byte("old"), 0600); err != nil {
				t.Fatal(err)
			}
			before, err := archiveDirectoryFiles(util.DataDir)
			if err != nil {
				t.Fatal(err)
			}
			writes := 0
			crashed := errors.New("simulated process interruption")
			operation := func() {
				defer func() {
					if recovered := recover(); recovered != nil && recovered != crashed {
						panic(recovered)
					}
				}()
				err = applyDataImport(directory, install, func(source, target string) error {
					writes++
					if writes == 2 {
						if crash {
							panic(crashed)
						}
						return errors.New("disk full")
					}
					return copyDataImportFile(source, target)
				})
			}
			operation()
			if !crash && err == nil {
				t.Fatal("write failure was ignored")
			}
			if err = recoverDataImports(); err != nil {
				t.Fatal(err)
			}
			after, err := archiveDirectoryFiles(util.DataDir)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("rollback did not restore original bytes: %v", err)
			}
		})
	}
}

func TestDataImportWaitsForActiveEncryptedReads(t *testing.T) {
	kek := dataImportTestWorkspace(t)
	defer zeroAndClear(kek)
	source := dataImportTestSnapshot(t)
	crypt, _ := GetBoxEncryption(dataImportTestID)
	dek, err := decryptWrappedDEK(dataImportTestID, crypt, kek)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	prepareUnlockedEncryptedBoxTest(t, dataImportTestID, dek)
	plan, err := PrepareDataImport(dataImportTestZip(t, source))
	if err != nil {
		t.Fatal(err)
	}
	if err = AcquireEncryptedBoxOperation(dataImportTestID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, commitErr := CommitDataImport(plan.ID, "overwrite", "import-password")
		done <- commitErr
	}()
	deadline := time.Now().Add(10 * time.Second)
	for GetEncryptedBoxState(dataImportTestID) != EncryptedBoxStateLocking && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if state := GetEncryptedBoxState(dataImportTestID); state != EncryptedBoxStateLocking {
		ReleaseEncryptedBoxOperation(dataImportTestID)
		t.Fatalf("did not enter locking state: %s", state)
	}
	select {
	case err = <-done:
		ReleaseEncryptedBoxOperation(dataImportTestID)
		t.Fatalf("import finished while an encrypted response was active: %v", err)
	default:
	}
	ReleaseEncryptedBoxOperation(dataImportTestID)
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("import did not finish after read release")
	}
}
