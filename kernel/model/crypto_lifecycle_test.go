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
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAcquireEncryptedBoxOperationsAllowsEmptyClosedScope(t *testing.T) {
	ctx, closeScope := WithEncryptedBoxOperationScope(context.Background())
	closeScope()
	release, err := AcquireEncryptedBoxOperations(ctx, nil)
	if err != nil {
		t.Fatalf("empty encrypted notebook operation set was rejected: %v", err)
	}
	release()
}

func TestEncryptedBoxOperationAdmissionCanWaitForInitialization(t *testing.T) {
	boxID := "20260812223000-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	setEncryptedBoxStateWithAdmission(boxID, EncryptedBoxStateUnlocked, false)
	if err := AcquireEncryptedBoxOperation(boxID); err == nil {
		ReleaseEncryptedBoxOperation(boxID)
		t.Fatal("encrypted notebook admitted an operation before initialization completed")
	}
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatalf("initialized encrypted notebook rejected an operation: %v", err)
	}
	ReleaseEncryptedBoxOperation(boxID)
}

func TestAcquireEncryptedBoxOperationsReportsClosedScope(t *testing.T) {
	boxID := "20260803190000-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)

	ctx, closeScope := WithEncryptedBoxOperationScope(context.Background())
	closeScope()
	_, err := AcquireEncryptedBoxOperations(ctx, []string{boxID})
	if !errors.Is(err, ErrEncryptedBoxOperationScopeClosed) {
		t.Fatalf("closed encrypted notebook operation scope returned unexpected error: %v", err)
	}
}

func TestEncryptedBoxLifecycleWaitsForActiveOperations(t *testing.T) {
	boxID := "20260731160000-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatalf("acquire encrypted notebook operation failed: %v", err)
	}

	done := make(chan struct{})
	go func() {
		releaseTransition := holdEncryptedBoxTransition(boxID)
		beginEncryptedBoxLock(boxID)
		cachedDEKsLock.Lock()
		if cached, ok := cachedDEKs[boxID]; ok {
			zeroAndClear(cached)
			delete(cachedDEKs, boxID)
		}
		cachedDEKsLock.Unlock()
		setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
		releaseTransition()
		close(done)
	}()

	deadline := time.Now().Add(time.Second)
	for GetEncryptedBoxState(boxID) != EncryptedBoxStateLocking && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateLocking {
		t.Fatalf("expected Locking state, got %s", state)
	}
	select {
	case <-done:
		t.Fatal("lock transition completed before the active operation was released")
	default:
	}
	if err := AcquireEncryptedBoxOperation(boxID); err == nil {
		t.Fatal("Locking state admitted a new operation")
	}

	ReleaseEncryptedBoxOperation(boxID)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("lock transition did not resume after the active operation ended")
	}
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateLocked {
		t.Fatalf("expected Locked state, got %s", state)
	}
}

func TestActiveOperationAllowsNestedAssetReadWhileLockWaits(t *testing.T) {
	boxID := "20260816193000-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()
	originalWorkspaceDir := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	defer func() {
		util.WorkspaceDir = originalWorkspaceDir
	}()
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)

	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	diskName := "asset-20260816193001-abcdefg.bin"
	plaintext := []byte("nested encrypted asset")
	ciphertext, err := EncryptAsset(boxID, diskName, diskName, dek, plaintext)
	clear(dek)
	if err != nil {
		t.Fatal(err)
	}
	assetDir := filepath.Join(util.DataDir, boxID, "assets")
	if err = os.MkdirAll(assetDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(assetDir, diskName), ciphertext, 0600); err != nil {
		t.Fatal(err)
	}

	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatal(err)
	}
	HoldBoxReadLock(boxID)
	lockDone := make(chan struct{})
	go func() {
		beginEncryptedBoxLock(boxID)
		setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
		close(lockDone)
	}()
	deadline := time.Now().Add(time.Second)
	for GetEncryptedBoxState(boxID) != EncryptedBoxStateLocking && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateLocking {
		ReleaseBoxReadLock(boxID)
		ReleaseEncryptedBoxOperation(boxID)
		t.Fatalf("expected Locking state, got %s", state)
	}

	read, readErr := ReadAssetBytesInBox(boxID, "assets/"+diskName)
	if readErr != nil || !bytes.Equal(read, plaintext) {
		ReleaseBoxReadLock(boxID)
		ReleaseEncryptedBoxOperation(boxID)
		t.Fatalf("nested asset read failed: data=%q err=%v", read, readErr)
	}
	ReleaseBoxReadLock(boxID)
	ReleaseEncryptedBoxOperation(boxID)
	select {
	case <-lockDone:
	case <-time.After(time.Second):
		t.Fatal("lock transition did not finish after the outer operation ended")
	}
}

func TestEncryptedBoxReadLockDoesNotWaitDuringLocking(t *testing.T) {
	boxID := "20260731160008-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	setEncryptedBoxState(boxID, EncryptedBoxStateLocking)
	done := make(chan struct{})
	go func() {
		HoldBoxReadLock(boxID)
		ReleaseBoxReadLock(boxID)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
		<-done
		t.Fatal("read lock waited during lock preparation")
	}
}

func TestEncryptedNotebookDeleteHistoryDistinguishesMissingNotebook(t *testing.T) {
	oldHistoryDir := util.HistoryDir
	util.HistoryDir = t.TempDir()
	defer func() {
		util.HistoryDir = oldHistoryDir
	}()

	boxID := "20260731160009-abcdefg"
	deleted, err := hasEncryptedNotebookDeleteHistory(boxID)
	if err != nil {
		t.Fatal(err)
	}
	if deleted {
		t.Fatal("missing delete history must not confirm notebook deletion")
	}

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	data, err := gulu.JSON.MarshalIndentJSON(boxConf, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(util.HistoryDir, "2026-07-31-160009-delete", boxID, ".siyuan", "conf.json")
	if err = os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(confPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	deleted, err = hasEncryptedNotebookDeleteHistory(boxID)
	if err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Fatal("encrypted delete history must confirm notebook deletion")
	}
}

func TestEncryptedBoxLockPreparationWaitsForActiveOperations(t *testing.T) {
	boxID := "20260731160005-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	mountedEncryptedBoxes.Store(boxID, true)
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatalf("acquire encrypted notebook operation failed: %v", err)
	}

	prepared := make(chan struct{})
	done := make(chan struct{})
	go func() {
		lockBoxWithPreparation(boxID, func() {
			close(prepared)
		})
		close(done)
	}()

	deadline := time.Now().Add(time.Second)
	for GetEncryptedBoxState(boxID) != EncryptedBoxStateLocking && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateLocking {
		t.Fatalf("expected Locking state, got %s", state)
	}
	select {
	case <-prepared:
		t.Fatal("lock preparation ran before the active operation was released")
	default:
	}

	ReleaseEncryptedBoxOperation(boxID)
	select {
	case <-prepared:
	case <-time.After(time.Second):
		t.Fatal("lock preparation did not run after the active operation ended")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("lock transition did not finish after preparation")
	}
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateLocked {
		t.Fatalf("expected Locked state, got %s", state)
	}
	if IsBoxUnlocked(boxID) {
		t.Fatal("locked notebook retained its DEK")
	}
	if isEncryptedBoxMounted(boxID) {
		t.Fatal("locked notebook retained its local mount state")
	}
}

func TestEncryptedBoxOperationReleaseSurvivesNotebookRemoval(t *testing.T) {
	boxID := "20260731160004-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatalf("acquire encrypted notebook operation failed: %v", err)
	}
	if err := os.RemoveAll(filepath.Join(util.DataDir, boxID)); err != nil {
		t.Fatal(err)
	}
	ReleaseEncryptedBoxOperation(boxID)

	lifecycle := getEncryptedBoxLifecycle(boxID)
	lifecycle.lock.Lock()
	activeOperations := lifecycle.activeOperations
	lifecycle.lock.Unlock()
	if activeOperations != 0 {
		t.Fatalf("expected no active operations after release, got %d", activeOperations)
	}
}

func TestMissingEncryptedIdentityNeverFallsBackToNormalNotebook(t *testing.T) {
	oldDataDir := util.DataDir
	oldConf := Conf
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	boxID := "20260731160100-abcdefg"
	defer func() {
		forgetRuntimeEncryptedBox(boxID)
		removeEncryptedBoxLifecycle(boxID)
		Conf = oldConf
		util.DataDir = oldDataDir
	}()

	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	key, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(key)
	ciphertext, err := util.EncryptWithAAD(key, []byte(`{"ID":"20260731160101-abcdefg"}`), []byte("identity-test"))
	if err != nil {
		t.Fatal(err)
	}
	rootPath := filepath.Join(boxDir, "20260731160101-abcdefg.sy")
	if err = os.WriteFile(rootPath, ciphertext, 0644); err != nil {
		t.Fatal(err)
	}

	boxes, err := ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(boxes) != 1 || !boxes[0].Encrypted || boxes[0].Unlocked || boxes[0].State != EncryptedBoxStateError {
		t.Fatalf("expected a quarantined encrypted notebook, got %+v", boxes)
	}
	confPath := filepath.Join(boxDir, ".siyuan", "conf.json")
	if _, statErr := os.Stat(confPath); !os.IsNotExist(statErr) {
		t.Fatalf("missing encrypted identity must not create a normal configuration: %v", statErr)
	}
	if _, keyErr := GetBoxEncryption(boxID); keyErr == nil {
		t.Fatal("ciphertext without key identity should report missing encrypted key material")
	}
	if saveErr := (&Box{ID: boxID}).SaveConf(conf.NewBoxConf()); saveErr == nil {
		t.Fatal("quarantined encrypted notebook must not be saved as a normal notebook")
	}
}

func TestNotebookBackupPreventsNormalIdentityDowngrade(t *testing.T) {
	oldConf := Conf
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	defer func() {
		Conf = oldConf
	}()

	boxID := "20260731160104-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()
	normalConf := conf.NewBoxConf()
	data, err := gulu.JSON.MarshalIndentJSON(normalConf, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err = os.WriteFile(confPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	forgetRuntimeEncryptedBox(boxID)

	if !IsEncryptedBox(boxID) {
		t.Fatal("a notebook key backup must prevent an encrypted notebook from being downgraded by a normal configuration")
	}
	boxes, err := ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(boxes) != 1 || !boxes[0].Encrypted {
		t.Fatalf("expected backup identity to quarantine the notebook, got %+v", boxes)
	}
}

func TestSyncedEncryptedNotebookRemovalClearsRuntimeState(t *testing.T) {
	boxID := "20260731160102-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	if !IsEncryptedBox(boxID) {
		t.Fatal("encrypted notebook identity was not detected")
	}
	mountedEncryptedBoxes.Store(boxID, true)
	if err := os.RemoveAll(filepath.Join(util.DataDir, boxID)); err != nil {
		t.Fatal(err)
	}
	if !IsEncryptedBox(boxID) {
		t.Fatal("runtime identity should survive synchronized identity-file removal until cleanup")
	}

	finalizeSyncedEncryptedBoxRemoval(boxID)
	if IsBoxUnlocked(boxID) {
		t.Fatal("synchronized notebook removal retained its DEK")
	}
	if isEncryptedBoxMounted(boxID) {
		t.Fatal("synchronized notebook removal retained its mount marker")
	}
	if isRuntimeEncryptedBox(boxID) || IsEncryptedBox(boxID) {
		t.Fatal("completed synchronized notebook removal retained its encryption identity")
	}
	if _, exists := encryptedBoxLifecycles.Load(boxID); exists {
		t.Fatal("completed synchronized notebook removal retained its lifecycle")
	}
}

func TestUnlockAndMountFailureKeepsPreexistingUnlock(t *testing.T) {
	boxID := "20260731160103-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	boxCrypt, err := GetBoxEncryption(boxID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(filepath.Join(util.DataDir, boxID)); err != nil {
		t.Fatal(err)
	}
	if _, err = UnlockAndMountBox(boxID, "unused", boxCrypt); err == nil {
		t.Fatal("mounting a removed notebook should fail")
	}
	if !IsBoxUnlocked(boxID) {
		t.Fatal("a mount failure must not roll back a preexisting unlock")
	}
}

func TestEncryptedBoxMetadataIsNotStoredInPlaintext(t *testing.T) {
	boxID := "20260731160001-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Icon = "1f512"
	boxConf.Sort = 42
	boxConf.SortMode = util.SortModeCustom
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save encrypted notebook configuration failed: %v", err)
	}

	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	data, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("1f512")) {
		t.Fatal("encrypted notebook icon was stored in plaintext")
	}
	raw := conf.NewBoxConf()
	if err = gulu.JSON.UnmarshalJSON(data, raw); err != nil {
		t.Fatal(err)
	}
	if raw.Icon != "" || raw.Sort != 0 || raw.SortMode != util.SortModeFileTree {
		t.Fatalf("plaintext metadata was not neutralized: icon=%q sort=%d sortMode=%d", raw.Icon, raw.Sort, raw.SortMode)
	}
	if raw.BoxCrypt == nil || len(raw.BoxCrypt.Metadata) == 0 {
		t.Fatal("encrypted notebook metadata ciphertext is missing")
	}

	unlocked := box.GetConf()
	if unlocked.Icon != "1f512" || unlocked.Sort != 42 || unlocked.SortMode != util.SortModeCustom {
		t.Fatalf("decrypted metadata mismatch: icon=%q sort=%d sortMode=%d", unlocked.Icon, unlocked.Sort, unlocked.SortMode)
	}

	cachedDEKsLock.Lock()
	delete(cachedDEKs, boxID)
	cachedDEKsLock.Unlock()
	setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
	locked := box.GetConf()
	if locked.Icon != "" || locked.Sort != 0 || locked.SortMode != util.SortModeFileTree {
		t.Fatalf("locked metadata was exposed: icon=%q sort=%d sortMode=%d", locked.Icon, locked.Sort, locked.SortMode)
	}
}

func TestListNotebooksDoesNotInheritEncryptedOpenState(t *testing.T) {
	oldConf := Conf
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	defer func() {
		Conf = oldConf
	}()

	boxID := "20260731160007-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Closed = true
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)

	boxes, err := ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(boxes) != 1 || boxes[0].Closed || !boxes[0].Unlocked {
		t.Fatalf("expected locally unlocked notebook to be open, got %+v", boxes)
	}
	boxConf.Closed = false
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	cachedDEKsLock.Lock()
	if cached, ok := cachedDEKs[boxID]; ok {
		zeroAndClear(cached)
		delete(cachedDEKs, boxID)
	}
	cachedDEKsLock.Unlock()
	mountedEncryptedBoxes.Delete(boxID)
	setEncryptedBoxState(boxID, EncryptedBoxStateLocked)

	boxes, err = ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(boxes) != 1 || !boxes[0].Closed || boxes[0].Unlocked {
		t.Fatalf("expected encrypted notebook without a local DEK to be closed, got %+v", boxes)
	}

	raw, err := readRawBoxConf(boxID)
	if err != nil {
		t.Fatal(err)
	}
	if raw.Closed {
		t.Fatal("test precondition failed: synchronized configuration should still contain closed=false")
	}
}

func TestEncryptedBoxMetadataAuthenticationFailureEntersErrorState(t *testing.T) {
	boxID := "20260731160003-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	box := &Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.Icon = "1f512"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	data, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatal(err)
	}
	raw := conf.NewBoxConf()
	if err = gulu.JSON.UnmarshalJSON(data, raw); err != nil {
		t.Fatal(err)
	}
	raw.BoxCrypt.Metadata[len(raw.BoxCrypt.Metadata)-1] ^= 0xff
	data, err = gulu.JSON.MarshalIndentJSON(raw, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(confPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	loaded := box.GetConf()
	if state := GetEncryptedBoxState(boxID); state != EncryptedBoxStateError {
		t.Fatalf("expected Error state after metadata authentication failure, got %s", state)
	}
	if loaded.Icon != "" {
		t.Fatalf("unauthenticated metadata was exposed: %q", loaded.Icon)
	}
	if err = box.SaveConf(loaded); err == nil {
		t.Fatal("saving an encrypted notebook in the Error state should be rejected")
	}
	if err = AcquireEncryptedBoxOperation(boxID); err == nil {
		t.Fatal("an encrypted notebook in the Error state should reject new operations")
	}
}

func TestNotebookCryptoLifecycleStateRequiresCompleteCurrentConfiguration(t *testing.T) {
	oldDataDir := util.DataDir
	oldConf := Conf
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	defer func() {
		Conf = oldConf
		util.DataDir = oldDataDir
	}()

	incomplete := conf.NewNotebookCrypto()
	incomplete.Enabled = true
	Conf.m.Lock()
	*Conf.NotebookCrypto = *incomplete
	Conf.m.Unlock()
	if state := NotebookCryptoLifecycleState(false); state != NotebookCryptoStateRecoveryRequired {
		t.Fatalf("expected RecoveryRequired for incomplete enabled configuration, got %s", state)
	}

	kek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	verifier, err := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:kek-verifier"))
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := util.EncryptionNonce(verifier)
	if err != nil {
		t.Fatal(err)
	}
	current := conf.NewNotebookCrypto()
	current.Enabled = true
	current.MasterSalt = bytes.Repeat([]byte{1}, 16)
	current.KEKVerifier = verifier
	current.VerifierNonce = nonce
	prepareBackupForWrite(current)
	current.KEKMAC = computeKEKMAC(current, kek)
	Conf.m.Lock()
	*Conf.NotebookCrypto = *current
	Conf.m.Unlock()
	if state := NotebookCryptoLifecycleState(false); state != NotebookCryptoStateEnabled {
		t.Fatalf("expected Enabled for complete current configuration, got %s", state)
	}
}

func TestRecoveryRequiredHistoryRestoresAuthenticatedBackup(t *testing.T) {
	oldDataDir := util.DataDir
	oldHistoryDir := util.HistoryDir
	oldConfDir := util.ConfDir
	oldConf := Conf
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.HistoryDir = filepath.Join(root, "history")
	util.ConfDir = filepath.Join(root, "conf")
	for _, dir := range []string{util.DataDir, util.HistoryDir, util.ConfDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	defer func() {
		Conf = oldConf
		util.DataDir = oldDataDir
		util.HistoryDir = oldHistoryDir
		util.ConfDir = oldConfDir
	}()

	password := "restore-history-key-backup"
	salt, err := util.GenerateSalt()
	if err != nil {
		t.Fatal(err)
	}
	params := util.DefaultArgon2Params()
	kek := util.DeriveKey(password, salt, params)
	defer zeroAndClear(kek)
	verifier, err := util.EncryptWithAAD(kek, kekVerifierMagic, []byte("siyuan:kek-verifier"))
	if err != nil {
		t.Fatal(err)
	}
	verifierNonce, err := util.EncryptionNonce(verifier)
	if err != nil {
		t.Fatal(err)
	}
	backup := &conf.NotebookCrypto{
		Enabled:       true,
		MasterSalt:    salt,
		KDFParams:     params,
		KEKVerifier:   verifier,
		VerifierNonce: verifierNonce,
	}
	if err = writeNotebookCryptoBackupData(backup, kek); err != nil {
		t.Fatal(err)
	}

	boxID := "20260731160006-abcdefg"
	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	wrappedDEK, err := util.EncryptWithAAD(kek, dek, wrappedDEKAAD(boxID))
	if err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxConf.BoxCrypt = &conf.BoxEncryption{
		Spec:       boxEncryptionSpec,
		WrappedDEK: wrappedDEK,
		WrapNonce:  mustEncryptionNonce(wrappedDEK),
		CreatedAt:  time.Now().UnixMilli(),
	}
	if err = encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	historyBoxDir := filepath.Join(util.HistoryDir, "2026-07-31-160006-delete", boxID, ".siyuan")
	if err = os.MkdirAll(historyBoxDir, 0755); err != nil {
		t.Fatal(err)
	}
	boxCryptData, err := gulu.JSON.MarshalIndentJSON(boxConf.BoxCrypt, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(historyBoxDir, "notebook-crypto-backup.json"), boxCryptData, 0644); err != nil {
		t.Fatal(err)
	}

	if state := NotebookCryptoLifecycleState(true); state != NotebookCryptoStateRecoveryRequired {
		t.Fatalf("expected RecoveryRequired before restoring history key material, got %s", state)
	}
	if err = EnableEncryptedNotebook(password); err != nil {
		t.Fatalf("restore encrypted notebook configuration from history dependency failed: %v", err)
	}
	if state := NotebookCryptoLifecycleState(true); state != NotebookCryptoStateEnabled {
		t.Fatalf("expected Enabled after restoring history key material, got %s", state)
	}
}

func TestHistoricalAttributeViewRejectsMissingEncryptedContext(t *testing.T) {
	key, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := util.EncryptWithAAD(key, []byte("{}"), []byte("test"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = decryptHistoricalAttributeView("", "20260731160002-abcdefg", ciphertext); err == nil {
		t.Fatal("encrypted attribute view history without notebook context should be rejected")
	}
}

func prepareEncryptedBoxLifecycleTest(t *testing.T, boxID string) func() {
	t.Helper()
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()

	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	cachedDEKsLock.Lock()
	cachedDEKs[boxID] = append([]byte(nil), dek...)
	cachedDEKsLock.Unlock()

	kek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	wrappedDEK, err := util.EncryptWithAAD(kek, dek, wrappedDEKAAD(boxID))
	zeroAndClear(kek)
	if err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Encrypted"
	boxConf.Encrypted = true
	boxConf.BoxCrypt = &conf.BoxEncryption{
		Spec:       boxEncryptionSpec,
		WrappedDEK: wrappedDEK,
		WrapNonce:  mustEncryptionNonce(wrappedDEK),
		CreatedAt:  time.Now().UnixMilli(),
	}
	if err = (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	return func() {
		mountedEncryptedBoxes.Delete(boxID)
		cachedDEKsLock.Lock()
		if cached, ok := cachedDEKs[boxID]; ok {
			zeroAndClear(cached)
			delete(cachedDEKs, boxID)
		}
		cachedDEKsLock.Unlock()
		zeroAndClear(dek)
		removeEncryptedBoxLifecycle(boxID)
		forgetRuntimeEncryptedBox(boxID)
		util.DataDir = oldDataDir
	}
}
