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

func TestManagedEncryptedExportRevocation(t *testing.T) {
	boxID := "20260711211244-abcdefg"
	artifact := filepath.Join(t.TempDir(), "export.zip")
	if err := os.WriteFile(artifact, []byte("plaintext"), 0600); err != nil {
		t.Fatal(err)
	}

	relativePath := registerManagedEncryptedExport(boxID, "resources", artifact)
	resolvedBoxID, resolvedArtifact, ok := ResolveManagedEncryptedExport("/" + relativePath)
	if !ok || resolvedBoxID != boxID || resolvedArtifact != artifact {
		t.Fatalf("managed export was not resolved correctly: box=%q artifact=%q ok=%t", resolvedBoxID, resolvedArtifact, ok)
	}

	RevokeManagedEncryptedExportsForBox(boxID)
	if _, _, ok = ResolveManagedEncryptedExport(relativePath); ok {
		t.Fatal("revoked managed export remained downloadable")
	}
}

func TestMobileExportLeaseLifecycle(t *testing.T) {
	originalTempDir := util.TempDir
	util.TempDir = t.TempDir()
	defer func() {
		util.TempDir = originalTempDir
	}()

	artifact := filepath.Join(util.TempDir, "export", "result.zip")
	if err := os.MkdirAll(filepath.Dir(artifact), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, []byte("result"), 0600); err != nil {
		t.Fatal(err)
	}

	lease, err := AcquireMobileExportLease("/export/result.zip")
	if err != nil {
		t.Fatal(err)
	}
	if lease.ID == "" || lease.Path != artifact || lease.Name != "result.zip" || lease.Size != 6 {
		t.Fatalf("unexpected mobile export lease: %#v", lease)
	}
	if _, ok := mobileExportLeases.leases[lease.ID]; !ok {
		t.Fatalf("mobile export lease was not registered")
	}

	ReleaseMobileExportLease(lease.ID)
	ReleaseMobileExportLease(lease.ID)
	if _, ok := mobileExportLeases.leases[lease.ID]; ok {
		t.Fatalf("mobile export lease was not released")
	}
	if _, err = os.Stat(artifact); err != nil {
		t.Fatalf("releasing a normal export lease should preserve the artifact: %v", err)
	}
}

func TestMobileExportLeaseRejectsTraversal(t *testing.T) {
	if _, err := AcquireMobileExportLease("/export/../secret.txt"); err == nil {
		t.Fatalf("mobile export lease should reject path traversal")
	}
}

func TestMobileExportLeaseExpiresAndReleasesBoxLock(t *testing.T) {
	originalTTL := mobileExportLeaseTTL
	mobileExportLeaseTTL = 20 * time.Millisecond
	defer func() {
		mobileExportLeaseTTL = originalTTL
	}()

	cleanupDir := t.TempDir()
	artifact := filepath.Join(cleanupDir, "export.zip")
	if err := os.WriteFile(artifact, []byte("plaintext"), 0600); err != nil {
		t.Fatal(err)
	}
	boxID := "20260731170000-lease01"
	HoldBoxReadLock(boxID)
	lease, err := registerMobileExportLeaseWithID("expiring-lease", boxID, artifact, "export.zip", cleanupDir)
	if err != nil {
		ReleaseBoxReadLock(boxID)
		t.Fatal(err)
	}

	writerAcquired := make(chan struct{})
	go func() {
		acquireBoxWriteLock(boxID)
		close(writerAcquired)
		releaseBoxWriteLock(boxID)
	}()
	select {
	case <-writerAcquired:
	case <-time.After(2 * time.Second):
		ReleaseMobileExportLease(lease.ID)
		t.Fatal("expired mobile export lease did not release the box read lock")
	}

	mobileExportLeases.Lock()
	_, exists := mobileExportLeases.leases[lease.ID]
	mobileExportLeases.Unlock()
	if exists {
		t.Fatal("expired mobile export lease remained registered")
	}
	if _, statErr := os.Stat(cleanupDir); !os.IsNotExist(statErr) {
		t.Fatalf("expired mobile export lease did not remove plaintext directory: %v", statErr)
	}
}

func TestMobileExportLeaseStreamsEncryptedAsset(t *testing.T) {
	originalDataDir := util.DataDir
	originalTempDir := util.TempDir
	originalWorkspaceDir := util.WorkspaceDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	util.TempDir = t.TempDir()
	boxID := "20260731153000-export1"
	defer func() {
		LockBox(boxID)
		util.DataDir = originalDataDir
		util.TempDir = originalTempDir
		util.WorkspaceDir = originalWorkspaceDir
	}()

	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
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
	confDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	confData, err := gulu.JSON.MarshalIndentJSON(boxConf, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(confDir, "conf.json"), confData, 0600); err != nil {
		t.Fatal(err)
	}

	setDEKForTest(boxID, dek)
	diskName := "asset-20260731153001-abcdefg.bin"
	originalName := "移动端大附件.bin"
	plaintext := bytes.Repeat([]byte("mobile-streaming-"), encryptedAssetChunkSize/17*2+100)
	ciphertext, err := EncryptAsset(boxID, diskName, originalName, dek, plaintext)
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

	lease, err := AcquireMobileExportLease("assets/" + diskName + "?box=" + boxID)
	if err != nil {
		t.Fatal(err)
	}
	if lease.Name != originalName {
		t.Fatalf("unexpected lease name: %q", lease.Name)
	}
	exported, err := os.ReadFile(lease.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(exported, plaintext) {
		t.Fatalf("unexpected exported content size: %d", len(exported))
	}
	cleanupDir := filepath.Dir(lease.Path)
	ReleaseMobileExportLease(lease.ID)
	if _, err = os.Stat(cleanupDir); !os.IsNotExist(err) {
		t.Fatalf("releasing the lease should remove plaintext temp data: %v", err)
	}
}

func TestLockBoxRevokesAndRemovesManagedExport(t *testing.T) {
	boxID := "20260711211244-abcdefg"
	originalTempDir := util.TempDir
	util.TempDir = t.TempDir()
	defer func() {
		LockBox(boxID)
		util.TempDir = originalTempDir
	}()

	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	setDEKForTest(boxID, dek)
	exportID, err := newManagedEncryptedExportID()
	if err != nil {
		t.Fatal(err)
	}
	artifact := filepath.Join(util.TempDir, "export", boxID, "repo", exportID, "document.sy.zip")
	if err = os.MkdirAll(filepath.Dir(artifact), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(artifact, []byte("plaintext"), 0600); err != nil {
		t.Fatal(err)
	}
	clipboardArtifact := filepath.Join(util.TempDir, "clipboard", boxID, "batch", "image.png")
	if err = os.MkdirAll(filepath.Dir(clipboardArtifact), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(clipboardArtifact, []byte("plaintext"), 0600); err != nil {
		t.Fatal(err)
	}
	relativePath := registerManagedEncryptedExport(boxID, filepath.Join("repo", exportID), artifact)

	LockBox(boxID)
	if _, _, ok := ResolveManagedEncryptedExport(relativePath); ok {
		t.Fatal("locking the notebook should revoke the managed export")
	}
	if _, statErr := os.Stat(artifact); !os.IsNotExist(statErr) {
		t.Fatalf("locking the notebook should remove the managed export artifact: %v", statErr)
	}
	if _, statErr := os.Stat(clipboardArtifact); !os.IsNotExist(statErr) {
		t.Fatalf("locking the notebook should remove rich clipboard assets: %v", statErr)
	}
}

func TestClearEncryptedExportTempOnBoot(t *testing.T) {
	originalTempDir := util.TempDir
	util.TempDir = t.TempDir()
	defer func() {
		util.TempDir = originalTempDir
	}()

	staleEncryptedExport := filepath.Join(util.TempDir, "export", "20260720120000-abcdefg", "markdown", "artifact.zip")
	pluginTemp := filepath.Join(util.TempDir, "export", "temp_plugin_package.zip")
	if err := os.MkdirAll(filepath.Dir(staleEncryptedExport), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(staleEncryptedExport, []byte("plaintext"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pluginTemp, []byte("plugin"), 0600); err != nil {
		t.Fatal(err)
	}

	clearEncryptedExportTempOnBoot()

	if _, err := os.Stat(filepath.Join(util.TempDir, "export", "20260720120000-abcdefg")); !os.IsNotExist(err) {
		t.Fatalf("stale encrypted export temp should be removed: %v", err)
	}
	if _, err := os.Stat(pluginTemp); err != nil {
		t.Fatalf("plugin temp should be preserved: %v", err)
	}
}

func TestCopyExportResourceDirectory(t *testing.T) {
	source := filepath.Join(t.TempDir(), "assets")
	nested := filepath.Join(source, "nested")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "resource.txt"), []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(t.TempDir(), "export")
	if err := copyExportResource(source, destination); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(destination, "nested", "resource.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "content" {
		t.Fatalf("unexpected copied content: %q", content)
	}
}

func TestCopyEncryptedAssetCreatesExportDirectory(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalDataDir := util.DataDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	boxID := "20260802120000-abcdefg"
	defer func() {
		LockBox(boxID)
		util.WorkspaceDir = originalWorkspaceDir
		util.DataDir = originalDataDir
	}()

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
	plaintext := []byte("encrypted export asset")
	diskName := "asset-20260802120001-abcdefg.png"
	ciphertext, err := EncryptAsset(boxID, diskName, "image.png", dek, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(util.DataDir, boxID, "assets", diskName)
	if err = os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(source, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(t.TempDir(), "export", "assets", diskName)
	if err = copyAssetDecryptIfEncrypted(source, destination); err != nil {
		t.Fatal(err)
	}
	exported, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(exported, plaintext) {
		t.Fatalf("unexpected exported asset content: %q", exported)
	}
}

func TestUniqueExportFilePath(t *testing.T) {
	destination := filepath.Join(t.TempDir(), "resource.txt")
	if err := os.WriteFile(destination, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	if actual := uniqueExportFilePath(destination); actual != filepath.Join(filepath.Dir(destination), "resource (2).txt") {
		t.Fatalf("unexpected unique export path: %s", actual)
	}
}
