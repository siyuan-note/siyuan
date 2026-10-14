package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestReadyInstallPackageDiagnosticsDoNotExposeMetadata(t *testing.T) {
	secret := strings.Repeat("1234567890", 1000)
	var metadata installPackageMetadata
	err := json.Unmarshal([]byte(`{"signature":`+secret+`}`), &metadata)
	if err == nil {
		t.Fatal("expected malformed signature type")
	}
	diagnostics := readyInstallPackageDiagnostics{}
	message := diagnostics.rejected("package.json", err)
	if len(message) > 160 || strings.Contains(message, "1234567890") || !strings.Contains(message, "invalid install package metadata JSON") {
		t.Fatalf("metadata content was not safely classified: %q", message)
	}
	message = diagnostics.rejected("package.json", &os.PathError{Op: "open", Path: "private\npath", Err: os.ErrPermission})
	if strings.Contains(message, "private") || strings.Contains(message, "\n") || !strings.Contains(message, "permission denied") {
		t.Fatalf("filesystem error included uncontrolled path content: %q", message)
	}
}

func TestReadyInstallPackageDiagnosticLimit(t *testing.T) {
	diagnostics := readyInstallPackageDiagnostics{}
	for i := 0; i < 8; i++ {
		message := diagnostics.rejected("package\nname.json", errors.New("metadata authentication failed"))
		if i < readyInstallPackageDiagnosticLimit {
			if !strings.Contains(message, "metadata authentication failed") || strings.Contains(message, "\n") {
				t.Fatalf("missing reason or unescaped record name: %q", message)
			}
		} else if message != "" {
			t.Fatal("diagnostic limit exceeded")
		}
	}
	if !strings.Contains(diagnostics.summary(), "5 additional") {
		t.Fatalf("missing suppressed warning count: %s", diagnostics.summary())
	}
	if message := (&readyInstallPackageDiagnostics{}).summary(); message != "" {
		t.Fatalf("successful or empty checks should not warn: %s", message)
	}
}

func TestReadyInstallPackageValidationReasons(t *testing.T) {
	dir := t.TempDir()
	metadata := installPackageFixture(t, dir, "3.8.6", conf.UpdateChannelStable, "win.exe")
	path := filepath.Join(dir, metadata.FileName)
	if got, err := verifyInstallPackagePath(dir, metadata); err != nil || got != path {
		t.Fatalf("valid package rejected: %s %v", got, err)
	}
	if err := os.WriteFile(path, []byte("incomplete"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := verifyInstallPackagePath(dir, metadata); got != "" || err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("checksum failure is not distinguishable: %s %v", got, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got, err := verifyInstallPackagePath(dir, metadata); got != "" || !os.IsNotExist(errors.Unwrap(err)) {
		t.Fatalf("missing package reason lost: %s %v", got, err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if got, err := verifyInstallPackagePath(dir, metadata); got != "" || err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("file type failure is not distinguishable: %s %v", got, err)
	}
	if got, err := verifyInstallPackagePath(dir, nil); got != "" || err == nil {
		t.Fatalf("invalid metadata was accepted: %s %v", got, err)
	}
}
