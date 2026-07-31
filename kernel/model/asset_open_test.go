package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPrepareAssetForOpen(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalDataDir := util.DataDir
	originalTempDir := util.TempDir
	originalConf := Conf
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	util.TempDir = filepath.Join(workspaceDir, "temp")
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Editor.VirtualBlockRef = false
	boxID := "20260801120000-assetop"
	defer func() {
		LockBox(boxID)
		util.WorkspaceDir = originalWorkspaceDir
		util.DataDir = originalDataDir
		util.TempDir = originalTempDir
		Conf = originalConf
	}()

	plainAssetPath := filepath.Join(util.DataDir, "assets", "plain.png")
	if err := os.MkdirAll(filepath.Dir(plainAssetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(plainAssetPath, []byte("plain image"), 0600); err != nil {
		t.Fatal(err)
	}
	preparedPlainPath, err := PrepareAssetForOpen("assets/plain.png")
	if err != nil {
		t.Fatal(err)
	}
	if preparedPlainPath != plainAssetPath {
		t.Fatalf("plain asset path changed: got %q, want %q", preparedPlainPath, plainAssetPath)
	}

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	confData, err := gulu.JSON.MarshalIndentJSON(boxConf, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err = os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(confPath, confData, 0600); err != nil {
		t.Fatal(err)
	}

	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	setDEKForTest(boxID, dek)
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	diskName := "asset-20260801120001-abcdefg.png"
	originalName := "机密图片.png"
	plaintext := []byte("encrypted image")
	ciphertext, err := EncryptAsset(boxID, diskName, originalName, dek, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	encryptedAssetPath := filepath.Join(util.DataDir, boxID, "assets", diskName)
	if err = os.MkdirAll(filepath.Dir(encryptedAssetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(encryptedAssetPath, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}

	preparedEncryptedPath, err := PrepareAssetForOpen("assets/" + diskName + "?box=" + boxID)
	if err != nil {
		t.Fatal(err)
	}
	wantTempRoot := filepath.Join(util.TempDir, "export", boxID, "asset-open")
	if rel, relErr := filepath.Rel(wantTempRoot, preparedEncryptedPath); relErr != nil || rel == ".." ||
		strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		t.Fatalf("prepared encrypted asset escaped its temporary root: %q", preparedEncryptedPath)
	}
	if filepath.Base(preparedEncryptedPath) != originalName {
		t.Fatalf("prepared encrypted asset name: got %q, want %q", filepath.Base(preparedEncryptedPath), originalName)
	}
	preparedContent, err := os.ReadFile(preparedEncryptedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(preparedContent) != string(plaintext) {
		t.Fatalf("prepared encrypted asset content: got %q, want %q", preparedContent, plaintext)
	}

	LockBox(boxID)
	if _, err = os.Stat(preparedEncryptedPath); !os.IsNotExist(err) {
		t.Fatalf("locking the notebook should remove the prepared asset: %v", err)
	}
	if _, err = PrepareAssetForOpen("assets/" + diskName + "?box=" + boxID); err == nil {
		t.Fatal("locked encrypted asset was prepared")
	}
}
