package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNotebookArchivePasswordChangePreservesArchiveGenerations(t *testing.T) {
	notebookArchiveTestWorkspace(t)
	if err := EnableEncryptedNotebook("old-archive-password"); err != nil {
		t.Fatal(err)
	}
	kek, err := deriveKEK("old-archive-password")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(kek)
	id := "20261011120000-archive"
	ciphertext := notebookArchiveTestBox(t, id, kek)
	oldID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	oldDirectory, _ := notebookArchiveDirectory(oldID)
	oldArchive := filepath.Join(oldDirectory, "archive.zip")
	if err = CommitNotebookArchive(oldID, true); err != nil {
		t.Fatal(err)
	}
	// 将归档移出的测试笔记本放回，继续验证同一份密文的包络改密。
	source := filepath.Join(oldDirectory, "removed", "data", id)
	err = archiveWalk(source, func(name, path string) error {
		return archiveCopyFile(path, filepath.Join(util.DataDir, id, filepath.FromSlash(name)))
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = ChangeMasterPassword("old-archive-password", "new-archive-password"); err != nil {
		t.Fatal(err)
	}
	if _, err = deriveKEK("old-archive-password"); err == nil {
		t.Fatal("password change retained the old password")
	}
	// 打包不读取配置文件，即使磁盘内容过时也使用已生成的持久化形态。
	if err = os.WriteFile(filepath.Join(util.ConfDir, "conf.json"), []byte(`{"notebookCrypto":null}`), 0600); err != nil {
		t.Fatal(err)
	}
	newID, _, err := PrepareNotebookArchive([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	newDirectory, _ := notebookArchiveDirectory(newID)
	newArchive := filepath.Join(newDirectory, "archive.zip")
	legacyDirectory := t.TempDir()
	manifest, err := readNotebookArchive(oldArchive, filepath.Join(legacyDirectory, "payload"))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"conf.json", "backup.json"} {
		if err = os.Remove(filepath.Join(legacyDirectory, "payload", "keys", name)); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	}
	if err = writeNotebookArchive(legacyDirectory, manifest); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct{ name, archive, password string }{
		{"old", oldArchive, "old-archive-password"},
		{"new", newArchive, "new-archive-password"},
		{"legacy-persisted-key", filepath.Join(legacyDirectory, "archive.zip"), "old-archive-password"},
	} {
		t.Run(entry.name, func(t *testing.T) {
			notebookArchiveTestWorkspace(t)
			if err := ImportNotebookArchive(entry.archive, "invalid-password", nil); !errors.Is(err, ErrNotebookArchiveAuthentication) {
				t.Fatalf("wrong password accepted: %v", err)
			}
			if err := ImportNotebookArchive(entry.archive, entry.password, nil); err != nil {
				t.Fatal(err)
			}
			restored, err := os.ReadFile(filepath.Join(util.DataDir, id, id+".sy"))
			if err != nil || !bytes.Equal(restored, ciphertext) {
				t.Fatal("recovery changed authenticated ciphertext")
			}
			key, err := deriveKEK(entry.password)
			if err != nil {
				t.Fatal(err)
			}
			defer zeroAndClear(key)
			if _, _, err := decryptBoxCrypt(id, key); err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("new archive rejects revoked password", func(t *testing.T) {
		notebookArchiveTestWorkspace(t)
		if err := ImportNotebookArchive(newArchive, "old-archive-password", nil); !errors.Is(err, ErrNotebookArchiveAuthentication) {
			t.Fatalf("revoked password accepted: %v", err)
		}
	})
}
