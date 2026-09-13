package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInboxConvertRejectsEncryptedNotebookBeforeCloudAccess(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = originalDataDir })
	boxID := ast.NewNodeID()
	confDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(confDir, "conf.json"), []byte(`{"encrypted":true}`), 0644); err != nil {
		t.Fatal(err)
	}
	result, err := inboxConvert(map[string]any{"notebook": boxID, "ids": "1700000000000"})
	if err != nil || !result.IsError || len(result.Content) != 1 || !strings.Contains(result.Content[0].Text, "non-encrypted notebook") {
		t.Fatalf("expected encrypted target rejection before cloud access, got %+v, %v", result, err)
	}
}
