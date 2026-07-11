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

	relativePath := registerManagedEncryptedExport(boxID, artifact)
	resolvedBoxID, resolvedArtifact, ok := ResolveManagedEncryptedExport("/" + relativePath)
	if !ok || resolvedBoxID != boxID || resolvedArtifact != artifact {
		t.Fatalf("managed export was not resolved correctly: box=%q artifact=%q ok=%t", resolvedBoxID, resolvedArtifact, ok)
	}

	RevokeManagedEncryptedExportsForBox(boxID)
	if _, _, ok = ResolveManagedEncryptedExport(relativePath); ok {
		t.Fatal("revoked managed export remained downloadable")
	}
}
