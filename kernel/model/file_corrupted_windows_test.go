package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocIALLockedReadRecovers(t *testing.T) {
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
	release := lockFirstByteForTest(t, filePath)
	if attrs := cache.GetDocIALInBox(document, fixture.box.ID); attrs != nil {
		t.Fatalf("read-lock fixture unexpectedly has cached attributes: %v", attrs)
	}
	if attrs := fixture.box.docIAL(document); attrs != nil {
		t.Fatalf("unreadable file returned attributes: %v", attrs)
	}
	if attrs := cache.GetDocIALInBox(document, fixture.box.ID); attrs != nil {
		t.Fatalf("failed read populated document attributes: %v", attrs)
	}
	if _, err := os.Stat(filepath.Join(util.WorkspaceDir, "corrupted")); !os.IsNotExist(err) {
		t.Fatalf("locked read created a backup: %v", err)
	}
	release()
	if data, err := os.ReadFile(filePath); err != nil || !bytes.Equal(data, raw) {
		t.Fatalf("locked read changed document data: %q, %v", data, err)
	}
	if attrs := fixture.box.docIAL(document); attrs["title"] != "Source" {
		t.Fatalf("document did not recover after the read lock ended: %v", attrs)
	}
}
