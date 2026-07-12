package model

import (
	"os"
	"path/filepath"
	"testing"
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
