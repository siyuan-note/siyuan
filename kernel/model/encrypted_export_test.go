package model

import (
	"os"
	"path/filepath"
	"testing"

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
	relativePath := registerManagedEncryptedExport(boxID, filepath.Join("repo", exportID), artifact)

	LockBox(boxID)
	if _, _, ok := ResolveManagedEncryptedExport(relativePath); ok {
		t.Fatal("locking the notebook should revoke the managed export")
	}
	if _, statErr := os.Stat(artifact); !os.IsNotExist(statErr) {
		t.Fatalf("locking the notebook should remove the managed export artifact: %v", statErr)
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

func TestUniqueExportFilePath(t *testing.T) {
	destination := filepath.Join(t.TempDir(), "resource.txt")
	if err := os.WriteFile(destination, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	if actual := uniqueExportFilePath(destination); actual != filepath.Join(filepath.Dir(destination), "resource (2).txt") {
		t.Fatalf("unexpected unique export path: %s", actual)
	}
}
