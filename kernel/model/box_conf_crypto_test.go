// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentTargetEncryptedMetadataVersions(t *testing.T) {
	const boxID = "20261023050000-targets"
	dek := bytes.Repeat([]byte{0x31}, 32)
	key := util.DeriveSubKey(dek, "siyuan/box-metadata")
	defer zeroAndClear(key)
	wrap := func(payload string) *conf.BoxConf {
		t.Helper()
		ciphertext, err := util.EncryptWithAAD(key, []byte(payload), boxMetadataAAD(boxID))
		if err != nil {
			t.Fatal(err)
		}
		return &conf.BoxConf{Encrypted: true, BoxCrypt: &conf.BoxEncryption{Metadata: ciphertext}}
	}
	// 既有未版本化载荷保持相同认证用途和笔记本绑定，不按新版默认值重新解释。
	legacy := wrap(`{"icon":"1f4d4","sort":7,"sortMode":4}`)
	if err := decryptBoxMetadata(boxID, legacy, dek); err != nil || legacy.MetadataVersion != 1 || legacy.Icon != "1f4d4" || legacy.Sort != 7 {
		t.Fatalf("legacy metadata read failed: %+v, %v", legacy, err)
	}
	target := &conf.DocumentTarget{Version: 2, Notebook: boxID, Anchor: conf.DocumentTargetAnchor{Kind: "notebookRoot"},
		Parents: []string{"Private / parent"}, Title: "Private title", OnMissingParent: "create"}
	legacy.DocCreateTarget = target
	if err := encryptBoxMetadata(boxID, legacy, dek); err != nil {
		t.Fatal(err)
	}
	clearBoxMetadata(legacy)
	disk, _ := json.Marshal(legacy)
	if bytes.Contains(disk, []byte("Private")) || bytes.Contains(disk, []byte("docCreateTarget")) {
		t.Fatal("protected targets leaked into plaintext configuration")
	}
	if err := decryptBoxMetadata(boxID, legacy, dek); err != nil || legacy.MetadataVersion != 2 || legacy.DocCreateTarget.Title != target.Title {
		t.Fatalf("version 2 read failed: %+v, %v", legacy, err)
	}
	legacy.DocCreateTarget = nil
	if err := encryptBoxMetadata(boxID, legacy, dek); err != nil {
		t.Fatal(err)
	}
	if err := decryptBoxMetadata(boxID, legacy, dek); err != nil || legacy.MetadataVersion != 2 {
		t.Fatal("removing the last target downgraded the payload", err)
	}
	for _, payload := range []string{
		`{"version":3,"icon":"","sort":0,"sortMode":0}`,
		`{"icon":"","sort":0,"sortMode":0,"documentTargets":{}}`,
		`{"version":2,"icon":"","sort":0,"sortMode":0,"futureField":true}`,
		`{"version":3,"version":2,"icon":"","sort":0,"sortMode":0}`,
		`{"version":3,"Version":2,"icon":"","sort":0,"sortMode":0}`,
		`{"version":2,"icon":"","sort":0,"sortMode":0} {}`,
	} {
		future := wrap(payload)
		original := append([]byte(nil), future.BoxCrypt.Metadata...)
		if err := decryptBoxMetadata(boxID, future, dek); err == nil || !bytes.Equal(original, future.BoxCrypt.Metadata) {
			t.Fatal("unsupported metadata was accepted or changed")
		}
	}
	corrupt := wrap(`{"icon":"","sort":0,"sortMode":0}`)
	corrupt.BoxCrypt.Metadata[len(corrupt.BoxCrypt.Metadata)-1] ^= 1
	if err := decryptBoxMetadata(boxID, corrupt, dek); err == nil {
		t.Fatal("authentication failure was ignored")
	}
	if err := decryptBoxMetadata("20261023050001-another", legacy, dek); err == nil {
		t.Fatal("metadata moved across notebook identities")
	}
	previousData := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousData })
	name := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(corrupt)
	if err := os.WriteFile(name, data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := reuseBoxMetadataIfUnchanged(boxID, legacy, dek); err == nil {
		t.Fatal("save replaced metadata after authentication failure")
	}
	HideBoxConfSecret(legacy)
	if legacy.DocCreateTarget != nil || legacy.RefCreateTarget != nil || legacy.DailyNoteTarget != nil || legacy.BoxCrypt != nil {
		t.Fatal("non-administrator configuration leaked targets")
	}
}

func TestDocumentTargetEncryptedMetadataRecovery(t *testing.T) {
	oldConf, oldData, oldConfDir, oldHistory := Conf, util.DataDir, util.ConfDir, util.HistoryDir
	root := t.TempDir()
	util.DataDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	t.Cleanup(func() {
		Conf, util.DataDir, util.ConfDir, util.HistoryDir = oldConf, oldData, oldConfDir, oldHistory
	})
	for _, directory := range []string{util.DataDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(directory, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync.Store(conf.NewSync())
	if err := EnableEncryptedNotebook("document-target-old-password"); err != nil {
		t.Fatal(err)
	}
	const boxID = "20261023090000-crypt01"
	oldKEK, err := deriveKEK("document-target-old-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(oldKEK)
	crypt, dek, err := WrapNewDEK(boxID, oldKEK)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	target := &conf.DocumentTarget{Version: 2, Notebook: boxID, Anchor: conf.DocumentTargetAnchor{Kind: "notebookRoot"},
		Parents: []string{"Private parent"}, Title: "Private title", OnMissingParent: "create"}
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.Closed, boxConf.BoxCrypt = true, true, crypt
	boxConf.DocCreateTarget, boxConf.RefCreateTarget, boxConf.DailyNoteTarget = target, target, target
	if err = encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	metadata := bytes.Clone(boxConf.BoxCrypt.Metadata)
	clearBoxMetadata(boxConf)
	box := &Box{ID: boxID}
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		removeEncryptedBoxLifecycle(boxID)
		runtimeEncryptedBoxes.Delete(boxID)
		runtimeNormalBoxes.Delete(boxID)
	})
	boxConf = box.GetConf()
	if boxConf.DocCreateTarget != nil || boxConf.RefCreateTarget != nil || boxConf.DailyNoteTarget != nil {
		t.Fatal("locked read exposed protected targets")
	}
	boxConf.Name = "Renamed while locked"
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	raw, err := readRawBoxConf(boxID)
	if err != nil || !bytes.Equal(raw.BoxCrypt.Metadata, metadata) {
		t.Fatal("locked configuration save changed protected metadata", err)
	}
	boxConf.DocCreateTarget = target
	if err = box.SaveConf(boxConf); err == nil {
		t.Fatal("locked configuration accepted a protected target update")
	}
	if err = writeNotebookCryptBackup(boxID, raw.BoxCrypt); err != nil {
		t.Fatal(err)
	}
	salt := bytes.Clone(Conf.NotebookCrypto.MasterSalt)
	if err = ChangeMasterPassword("document-target-old-password", "document-target-new-password"); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(salt, Conf.NotebookCrypto.MasterSalt) {
		t.Fatal("password change regenerated the master salt")
	}
	newKEK, err := deriveKEK("document-target-new-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(newKEK)
	check := func() {
		t.Helper()
		recoveredDEK, recoveredCrypt, decryptErr := decryptBoxCrypt(boxID, newKEK)
		if decryptErr != nil {
			t.Fatal(decryptErr)
		}
		defer zeroAndClear(recoveredDEK)
		if !bytes.Equal(dek, recoveredDEK) || !bytes.Equal(metadata, recoveredCrypt.Metadata) {
			t.Fatal("rewrapping or backup recovery changed document keys or metadata")
		}
		recovered := &conf.BoxConf{BoxCrypt: recoveredCrypt}
		if decryptErr = decryptBoxMetadata(boxID, recovered, recoveredDEK); decryptErr != nil || recovered.MetadataVersion != 2 ||
			!reflect.DeepEqual(recovered.DocCreateTarget, target) || !reflect.DeepEqual(recovered.RefCreateTarget, target) ||
			!reflect.DeepEqual(recovered.DailyNoteTarget, target) {
			t.Fatal("recovered metadata lost a structured target", decryptErr)
		}
	}
	check()
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	for _, name := range []string{confPath, notebookCryptoBackupPath(boxID), dataCryptoBackupPath()} {
		data, readErr := os.ReadFile(name)
		if readErr != nil || bytes.Contains(data, []byte("Private")) || bytes.Contains(data, []byte("docCreateTarget")) {
			t.Fatal("configuration or backup leaked protected metadata", name, readErr)
		}
	}
	if err = os.Remove(confPath); err != nil {
		t.Fatal(err)
	}
	if _, _, err = decryptBoxCrypt(boxID, bytes.Repeat([]byte{0xff}, 32)); err == nil {
		t.Fatal("missing configuration bypassed key authentication")
	}
	if err = box.SaveConf(conf.NewBoxConf()); err == nil {
		t.Fatal("missing configuration allowed a plaintext replacement")
	}
	if _, err = os.Stat(confPath); !os.IsNotExist(err) {
		t.Fatal("failed recovery created a replacement configuration", err)
	}
	// 删除配置后只能从已认证的备份恢复相同 DEK 和目标载荷。
	check()
}
