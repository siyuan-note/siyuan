package model

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocIALSharingViolationRecovers(t *testing.T) {
	fixture := setupFileOperationTest(t)
	originalWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
	filePath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	cache.RemoveDocIAL(fixture.sourcePath)
	ptr, err := syscall.UTF16PtrFromString(filePath)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := syscall.CreateFile(ptr, syscall.GENERIC_READ, syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	defer func() {
		if !closed {
			syscall.CloseHandle(handle)
		}
	}()
	if _, err = os.Stat(filePath); err != nil {
		t.Fatal(err)
	}
	if attrs := fixture.box.docIAL(fixture.sourcePath); attrs != nil {
		t.Fatalf("unreadable file returned attributes: %v", attrs)
	}
	if _, err = os.Stat(filepath.Join(util.WorkspaceDir, "corrupted")); !os.IsNotExist(err) {
		t.Fatalf("sharing violation created a backup: %v", err)
	}
	if err = syscall.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	closed = true
	if attrs := fixture.box.docIAL(fixture.sourcePath); attrs["title"] != "Source" {
		t.Fatalf("document did not recover after sharing violation: %v", attrs)
	}
}
