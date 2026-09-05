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
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedAssetRejectsSplicedVersions(t *testing.T) {
	boxID := "20260905120000-review1"
	diskName := "asset-20260905120000-review1.bin"
	dek := bytes.Repeat([]byte{42}, 32)
	firstPlain := bytes.Repeat([]byte("A"), encryptedAssetChunkSize*2)
	secondPlain := bytes.Repeat([]byte("B"), encryptedAssetChunkSize*2)
	first, err := EncryptAsset(boxID, diskName, "first.bin", dek, firstPlain)
	if err != nil {
		t.Fatal(err)
	}
	second, err := EncryptAsset(boxID, diskName, "second.bin", dek, secondPlain)
	if err != nil {
		t.Fatal(err)
	}
	firstOffset := 8 + int(binary.BigEndian.Uint32(first[4:8]))
	secondOffset := 8 + int(binary.BigEndian.Uint32(second[4:8]))
	firstSize := 4 + int(binary.BigEndian.Uint32(first[firstOffset:firstOffset+4]))
	secondSize := 4 + int(binary.BigEndian.Uint32(second[secondOffset:secondOffset+4]))
	if firstSize != secondSize {
		t.Fatal("fixture chunk lengths differ")
	}
	for _, part := range []string{"first chunk", "last chunk", "all chunks", "metadata"} {
		t.Run(part, func(t *testing.T) {
			mixed := append([]byte(nil), second...)
			switch part {
			case "first chunk":
				copy(mixed[secondOffset:secondOffset+secondSize], first[firstOffset:firstOffset+firstSize])
			case "last chunk":
				copy(mixed[secondOffset+secondSize:], first[firstOffset+firstSize:])
			case "all chunks":
				copy(mixed[secondOffset:], first[firstOffset:])
			case "metadata":
				mixed = append(append([]byte(nil), first[:firstOffset]...), second[secondOffset:]...)
			}
			if _, _, err := DecryptAssetWithName(boxID, diskName, dek, mixed); err == nil {
				t.Fatal("accepted a never-encrypted mixed version")
			}
		})
	}
}

func TestEncryptedAssetRejectsUnboundContainerMetadata(t *testing.T) {
	boxID, diskName := "20260905120000-review1", "asset.bin"
	dek := bytes.Repeat([]byte{42}, 32)
	for _, spec := range []int{0, 1, encryptedAssetSpec + 1, encryptedAssetSpec} {
		metadata, err := json.Marshal(&encryptedAssetMetadata{Spec: spec, OriginalName: "asset.bin", Size: 0, Chunks: 1})
		if err != nil {
			t.Fatal(err)
		}
		key := util.DeriveSubKey(dek, "siyuan/asset")
		encryptedMetadata, err := util.EncryptWithAAD(key, metadata, []byte("siyuan:asset:"+boxID+":assets/"+diskName+":metadata"))
		zeroAndClear(key)
		if err != nil {
			t.Fatal(err)
		}
		container := append([]byte(nil), encryptedAssetMagic...)
		container = binary.BigEndian.AppendUint32(container, uint32(len(encryptedMetadata)))
		container = append(container, encryptedMetadata...)
		container = binary.BigEndian.AppendUint32(container, 0)
		if _, err = DecryptAssetName(boxID, diskName, dek, container); err == nil {
			t.Fatalf("metadata reader accepted unbound container spec %d", spec)
		}
		if _, err = DecryptAssetNameFromReader(boxID, diskName, dek, bytes.NewReader(container)); err == nil {
			t.Fatalf("streaming metadata reader accepted unbound container spec %d", spec)
		}
		var output bytes.Buffer
		if _, err = DecryptAssetToWriter(boxID, diskName, dek, bytes.NewReader(container), &output); err == nil || output.Len() != 0 {
			t.Fatalf("content reader accepted unbound container spec %d", spec)
		}
	}
}

func TestEncryptedAssetEmptyAndChunkBoundaries(t *testing.T) {
	boxID, diskName := "20260905120000-review1", "asset.bin"
	dek := bytes.Repeat([]byte{42}, 32)
	for _, size := range []int{0, encryptedAssetChunkSize - 1, encryptedAssetChunkSize, encryptedAssetChunkSize + 1} {
		plain := bytes.Repeat([]byte{23}, size)
		ciphertext, err := EncryptAsset(boxID, diskName, "asset.bin", dek, plain)
		if err != nil {
			t.Fatal(err)
		}
		decrypted, _, err := DecryptAssetWithName(boxID, diskName, dek, ciphertext)
		if err != nil || !bytes.Equal(plain, decrypted) {
			t.Fatalf("asset size %d failed round trip: %v", size, err)
		}
		if name, err := DecryptAssetNameFromReader(boxID, diskName, dek, bytes.NewReader(ciphertext)); err != nil || name != "asset.bin" {
			t.Fatalf("streaming name read failed: %v", err)
		}
	}
}

func TestPasswordChangePreservesDeletedHistoryRecovery(t *testing.T) {
	oldConf, oldDataDir, oldHistoryDir, oldConfDir := Conf, util.DataDir, util.HistoryDir, util.ConfDir
	root := t.TempDir()
	util.DataDir, util.HistoryDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "history"), filepath.Join(root, "conf")
	defer func() {
		Conf, util.DataDir, util.HistoryDir, util.ConfDir = oldConf, oldDataDir, oldHistoryDir, oldConfDir
	}()
	for _, dir := range []string{util.DataDir, util.HistoryDir, util.ConfDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	if err := EnableEncryptedNotebook("old-review-password"); err != nil {
		t.Fatal(err)
	}
	oldKEK, err := deriveKEK("old-review-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(oldKEK)
	boxID := "20260905120100-review2"
	crypt, dek, err := WrapNewDEK(boxID, oldKEK)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.BoxCrypt = true, crypt
	if err = encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	historyDir := filepath.Join(util.HistoryDir, "2026-09-05-120100-delete", boxID, ".siyuan")
	if err = os.MkdirAll(historyDir, 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(historyDir, "conf.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	data, err = json.Marshal(crypt)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(historyDir, notebookCryptoBackupFilename), data, 0644); err != nil {
		t.Fatal(err)
	}
	if !verifyKEKAgainstEncryptedHistory(oldKEK, nil) {
		t.Fatal("fixture history cannot be decrypted")
	}
	if err = ChangeMasterPassword("old-review-password", "new-review-password"); err != nil {
		t.Fatal(err)
	}
	if err = ChangeMasterPassword("new-review-password", "latest-password"); err != nil {
		t.Fatal(err)
	}
	newKEK, err := deriveKEK("latest-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(newKEK)
	if !verifyKEKAgainstEncryptedHistory(newKEK, currentNotebookCrypto()) {
		t.Fatal("current password cannot decrypt historical envelopes")
	}
	backupData, err := os.ReadFile(dataCryptoBackupPath())
	if err != nil {
		t.Fatal(err)
	}
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	_, recoveredKEK, err := deriveNotebookCryptoBackupCandidate("latest-password")
	if recoveredKEK != nil {
		zeroAndClear(recoveredKEK)
	}
	if err != nil {
		t.Fatalf("current valid backup cannot restore deleted history after successful password change: %v", err)
	}
	if err = ImportNotebookCryptoBackup(backupData, "latest-password"); err != nil {
		t.Fatalf("importing current backup cannot restore history: %v", err)
	}
	// 模拟从其他设备恢复改密前的目录，确认解锁路径也接受由当前备份保护的历史包络。
	boxDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err = os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"conf.json", notebookCryptoBackupFilename} {
		fileData, readErr := os.ReadFile(filepath.Join(historyDir, name))
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err = os.WriteFile(filepath.Join(boxDir, name), fileData, 0644); err != nil {
			t.Fatal(err)
		}
	}
	restoredDEK, _, err := decryptBoxCrypt(boxID, newKEK)
	defer zeroAndClear(restoredDEK)
	if err != nil || !bytes.Equal(restoredDEK, dek) {
		t.Fatalf("restored notebook cannot use current password: %v", err)
	}
}

func TestHistoryKEKsAuthenticateAndDeduplicate(t *testing.T) {
	first, second, third := bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32), bytes.Repeat([]byte{3}, 32)
	wrapped, err := rewrapHistoryKEKs(first, second, nil)
	if err != nil {
		t.Fatal(err)
	}
	wrapped, err = rewrapHistoryKEKs(second, third, wrapped)
	if err != nil {
		t.Fatal(err)
	}
	wrapped, err = rewrapHistoryKEKs(third, first, wrapped)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := decryptHistoryKEKs(first, wrapped)
	defer clearHistoryKEKs(keys)
	if err != nil || len(keys) != 2 || !bytes.Equal(keys[0], second) || !bytes.Equal(keys[1], third) {
		t.Fatalf("password reuse lost or duplicated history keys: count=%d err=%v", len(keys), err)
	}
	nc := conf.NewNotebookCrypto()
	nc.HistoryKEKs = wrapped
	prepareBackupForWrite(nc)
	nc.KEKMAC = computeKEKMAC(nc, first)
	if !verifyKEKMAC(nc, first) {
		t.Fatal("history key backup failed authentication")
	}
	nc.HistoryKEKs = nc.HistoryKEKs[:1]
	if verifyKEKMAC(nc, first) {
		t.Fatal("backup MAC accepted removed history key")
	}
	wrapped[1][len(wrapped[1])-1] ^= 1
	if keys, err = decryptHistoryKEKs(first, wrapped); err == nil || len(keys) != 0 {
		clearHistoryKEKs(keys)
		t.Fatal("tampered keyring was accepted or returned partial plaintext keys")
	}
}

func TestMasterPasswordMigrationRetainsHistoryKeysAfterBoxRemoval(t *testing.T) {
	oldDataDir, oldConfDir, oldHistoryDir, oldConf := util.DataDir, util.ConfDir, util.HistoryDir, Conf
	root := t.TempDir()
	util.DataDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	defer func() {
		util.DataDir, util.ConfDir, util.HistoryDir, Conf = oldDataDir, oldConfDir, oldHistoryDir, oldConf
	}()
	for _, dir := range []string{util.DataDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.NotebookCrypto, Conf.Sync = conf.NewNotebookCrypto(), conf.NewSync()
	if err := EnableEncryptedNotebook("migration-old"); err != nil {
		t.Fatal(err)
	}
	oldKEK, err := deriveKEK("migration-old")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(oldKEK)
	newKEK := util.DeriveKey("migration-new", Conf.NotebookCrypto.MasterSalt, Conf.NotebookCrypto.KDFParams)
	defer zeroAndClear(newKEK)
	wrapped, err := rewrapHistoryKEKs(oldKEK, newKEK, nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := util.EncryptWithAAD(newKEK, kekVerifierMagic, []byte("siyuan:kek-verifier"))
	if err != nil {
		t.Fatal(err)
	}
	boxID := "20260905124500-migrate"
	manifest := &masterPasswordMigration{OldVerifier: Conf.NotebookCrypto.KEKVerifier, NewVerifier: verifier, NewHistoryKEKs: wrapped, Boxes: []migrationBoxEntry{{BoxID: boxID}}}
	if err = writeMasterPasswordMigration(manifest); err != nil {
		t.Fatal(err)
	}
	Conf.NotebookCrypto.KEKVerifier = verifier
	Conf.NotebookCrypto.VerifierNonce = mustEncryptionNonce(verifier)
	removeMasterPasswordMigrationBox(boxID)
	if pending, _ := MasterPasswordMigrationStatus(); !pending {
		t.Fatal("removing last notebook discarded pending recovery keys")
	}
	recoverMasterPasswordMigration()
	derived, err := deriveKEK("migration-new")
	defer zeroAndClear(derived)
	if err != nil {
		t.Fatal(err)
	}
	if pending, _ := MasterPasswordMigrationStatus(); pending {
		t.Fatal("authenticated recovery did not finish migration")
	}
	backup, err := loadNotebookCryptoBackup()
	if err != nil || backup == nil || !verifyKEKMAC(backup, newKEK) {
		t.Fatalf("recovery did not publish authenticated backup: %v", err)
	}
	keys, err := decryptHistoryKEKs(newKEK, backup.HistoryKEKs)
	defer clearHistoryKEKs(keys)
	if err != nil || len(keys) != 1 || !bytes.Equal(keys[0], oldKEK) {
		t.Fatalf("recovery lost historical key: %v", err)
	}
}
