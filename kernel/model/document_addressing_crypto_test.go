// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func setDocumentAddressingTestMode(t *testing.T, boxDirectory string, mode int) {
	t.Helper()
	name := filepath.Join(boxDirectory, ".siyuan", "conf.json")
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	fields["documentAddressingVersion"], _ = json.Marshal(mode)
	data, err = json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentAddressingEncryptedAuthenticationPreservesKeys(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	password := "addressing-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK(password)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	boxID := "20261022120000-crypto1"
	_ = notebookArchiveTestBox(t, boxID, kek)
	crypt, err := GetBoxEncryption(boxID)
	if err != nil {
		t.Fatal(err)
	}
	setDocumentAddressingTestMode(t, filepath.Join(util.DataDir, boxID), 3)
	original, err := archiveDirectoryFiles(util.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	keyState, _ := json.Marshal(currentNotebookCrypto())
	if err := UnlockBox(boxID, "wrong-password", crypt); err == nil {
		t.Fatal("wrong password accepted")
	}
	after, err := archiveDirectoryFiles(util.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	beforeJSON, _ := json.Marshal(original)
	afterJSON, _ := json.Marshal(after)
	if !bytes.Equal(beforeJSON, afterJSON) {
		t.Fatal("rejected recovery changed ciphertext or key backups")
	}
	currentKeys, _ := json.Marshal(currentNotebookCrypto())
	if !bytes.Equal(currentKeys, keyState) || IsBoxUnlocked(boxID) {
		t.Fatal("rejected recovery changed keys or published a DEK")
	}
	if _, err = os.Stat(masterPasswordMigrationPath()); !os.IsNotExist(err) {
		t.Fatalf("rejected password change wrote a migration: %v", err)
	}
}

func TestDocumentAddressingCorruptEncryptedConfigurationWithoutBackup(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	Conf.FileTree.Store(conf.NewFileTree())
	password := "corrupt-addressing-configuration"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK(password)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	const boxID = "20261026000000-corrupt"
	_ = notebookArchiveTestBox(t, boxID, kek)
	name := filepath.Join(util.DataDir, boxID, documentaddressing.ConfigPath)
	original, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := append(bytes.Clone(original), '{')
	if err := os.WriteFile(name, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(notebookCryptoBackupPath(boxID)); err != nil {
		t.Fatal(err)
	}
	if _, err := listNotebooks(true); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(name); err != nil || !bytes.Equal(got, corrupt) {
		t.Fatal("notebook discovery removed recoverable encrypted configuration", err)
	}
}

func TestDocumentAddressingEncryptedArchiveIgnoresRetiredModes(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	password := "addressing-archive-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK(password)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	boxID := "20261022120000-crypto2"
	_ = notebookArchiveTestBox(t, boxID, kek)
	archiveID, _, err := PrepareNotebookArchive([]string{boxID})
	if err != nil {
		t.Fatal(err)
	}
	directory, _ := notebookArchiveDirectory(archiveID)
	legacyArchive := filepath.Join(directory, "archive.zip")
	futureDirectory := t.TempDir()
	manifest, err := readNotebookArchive(legacyArchive, filepath.Join(futureDirectory, "payload"))
	if err != nil {
		t.Fatal(err)
	}
	setDocumentAddressingTestMode(t, filepath.Join(futureDirectory, "payload", "data", boxID), 3)
	if err = writeNotebookArchive(futureDirectory, manifest); err != nil {
		t.Fatal(err)
	}
	futureArchive := filepath.Join(futureDirectory, "archive.zip")
	for _, test := range []struct {
		name, archive string
		remembered    bool
	}{
		{"incoming-mode", futureArchive, false},
		{"remembered-source-identity", legacyArchive, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			notebookArchiveTestWorkspace(t)
			if test.remembered {
				backup := []byte(`{"documentAddressing":{"version":1,"notebooks":{"` + boxID + `":3}}}`)
				if err := os.WriteFile(filepath.Join(util.ConfDir, "document-addressing.json"), backup, 0600); err != nil {
					t.Fatal(err)
				}
			}
			original, _ := os.ReadFile(test.archive)
			if err := ImportNotebookArchive(test.archive, "wrong-password", nil); !errors.Is(err, ErrNotebookArchiveAuthentication) {
				t.Fatalf("mode check bypassed authentication: %v", err)
			}
			if err := ImportNotebookArchive(test.archive, password, nil); err != nil {
				t.Fatalf("retired mode blocked authenticated archive: %v", err)
			}
			entries, _ := os.ReadDir(util.DataDir)
			if len(entries) == 0 || !currentNotebookCrypto().Enabled {
				t.Fatal("authenticated archive lost data or keys")
			}
			current, _ := os.ReadFile(test.archive)
			if !bytes.Equal(current, original) {
				t.Fatal("rejected archive changed its source")
			}
		})
	}
}
