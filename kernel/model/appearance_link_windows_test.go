package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestAppearanceMigrationLockedLinkPreservesSource(t *testing.T) {
	root := t.TempDir()
	external := filepath.Join(root, "开发资源")
	writeAppearanceTestFile(t, filepath.Join(external, "theme.css"), "development")
	source, target := filepath.Join(root, "source"), filepath.Join(root, "target")
	createAppearanceMigrationDirectoryLink(t, source, external)
	createAppearanceMigrationDirectoryLink(t, target, source)
	path, err := windows.UTF16PtrFromString(target)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(path, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if handle != windows.InvalidHandle {
			windows.CloseHandle(handle)
		}
	})
	if err = moveAppearancePackage(source, target); err == nil {
		t.Fatal("migration unexpectedly replaced a locked link")
	}
	for _, path := range []string{source, target} {
		if data, err := os.ReadFile(filepath.Join(path, "theme.css")); err != nil || string(data) != "development" {
			t.Fatalf("failed migration changed original link %s: %q, %v", path, data, err)
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".appearance-link-") {
			t.Fatalf("failed migration retained staging directory: %s", entry.Name())
		}
	}
	if err = windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	handle = windows.InvalidHandle
	if err = moveAppearancePackage(source, target); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("retry retained source link: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "theme.css")); err != nil || string(data) != "development" {
		t.Fatalf("retry broke target link: %q, %v", data, err)
	}
}
