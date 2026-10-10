package model

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sys/windows"
)

func TestDocIALSharingViolationRecovers(t *testing.T) {
	fixture := setupFileOperationTest(t)
	originalWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
	// 直接写入独立文档，避免建树时的异步缓存写入覆盖测试前的清理。
	id := ast.NewNodeID()
	document := "/" + id + ".sy"
	filePath := filepath.Join(util.DataDir, fixture.box.ID, document)
	raw := []byte(`{"Type":"NodeDocument","Properties":{"id":"` + id + `","title":"Source"}}`)
	if err := os.WriteFile(filePath, raw, 0644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cache.RemoveDocIALInBox(document, fixture.box.ID) })
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
	if _, readErr := os.ReadFile(filePath); !errors.Is(readErr, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("read-denying handle did not produce a sharing violation: %v", readErr)
	}
	if attrs := cache.GetDocIALInBox(document, fixture.box.ID); attrs != nil {
		t.Fatalf("sharing-violation fixture unexpectedly has cached attributes: %v", attrs)
	}
	if attrs := fixture.box.docIAL(document); attrs != nil {
		t.Fatalf("unreadable file returned attributes: %v", attrs)
	}
	if _, err = os.Stat(filepath.Join(util.WorkspaceDir, "corrupted")); !os.IsNotExist(err) {
		t.Fatalf("sharing violation created a backup: %v", err)
	}
	if err = syscall.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	closed = true
	if attrs := fixture.box.docIAL(document); attrs["title"] != "Source" {
		t.Fatalf("document did not recover after sharing violation: %v", attrs)
	}
}
