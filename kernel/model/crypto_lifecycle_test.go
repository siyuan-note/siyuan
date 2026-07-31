// SiYuan - Refactor your thinking
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
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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

func TestEncryptedBoxLockPreparationWaitsForActiveOperations(t *testing.T) {
	boxID := "20260731160005-abcdefg"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()

	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
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
		cachedDEKsLock.Lock()
		if cached, ok := cachedDEKs[boxID]; ok {
			zeroAndClear(cached)
			delete(cachedDEKs, boxID)
		}
		cachedDEKsLock.Unlock()
		zeroAndClear(dek)
		removeEncryptedBoxLifecycle(boxID)
		util.DataDir = oldDataDir
	}
}
