//go:build fts5

package model

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRemoveUnusedAttributeView(t *testing.T) {
	const childEnv = "SIYUAN_TEST_UNUSED_AV"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestRemoveUnusedAttributeView$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	fixture := setupFileOperationTest(t)
	setupAttributeViewRefI18n(t)
	util.HistoryDir = t.TempDir()
	util.HistoryDBPath = filepath.Join(t.TempDir(), "history.db")
	util.DBPath = filepath.Join(t.TempDir(), "siyuan.db")
	util.AssetContentDBPath = filepath.Join(t.TempDir(), "asset_content.db")
	sql.InitDatabase(true)
	sql.InitAssetContentDatabase(true)
	sql.InitHistoryDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	const id = "20260913000000-unused1"
	if err := av.SaveAttributeView(av.NewAttributeView(id)); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(util.DataDir, "storage", "av", id+".json")
	original, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(fixture.box.ID, "/20260913000001-doc0001.sy", "/Database", "Database")
	oldUndoLog := GlobalUndoLog
	GlobalUndoLog = newUndoLog(64)
	t.Cleanup(func() { GlobalUndoLog = oldUndoLog })
	history := &Transaction{fromAPI: true, trees: map[string]*parse.Tree{tree.ID: tree},
		DoOperations:   []*Operation{{Action: "setAttrViewName", AvID: id, Data: "New name"}},
		UndoOperations: []*Operation{{Action: "setAttrViewName", AvID: id, Data: "Old name"}},
	}
	GlobalUndoLog.Record(history)
	entry := GlobalUndoLog.Peek(tree.ID)
	tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: id})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	if err = RemoveUnusedAttributeView(id); err == nil {
		t.Fatal("referenced database was accepted")
	}
	if GlobalUndoLog.Peek(tree.ID) != entry {
		t.Fatal("rejected cleanup discarded valid undo history")
	}
	docPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
	if err = os.Remove(docPath); err != nil {
		t.Fatal(err)
	}
	templateDir := filepath.Join(util.DataDir, "templates")
	if err = os.MkdirAll(templateDir, 0755); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(templateDir, "database.md")
	if err = os.WriteFile(templatePath, []byte(id), 0644); err != nil {
		t.Fatal(err)
	}
	if err = RemoveUnusedAttributeView(id); err == nil {
		t.Fatal("template database was accepted")
	}
	if data, readErr := os.ReadFile(source); readErr != nil || !bytes.Equal(data, original) {
		t.Fatalf("referenced database changed: %v", readErr)
	}
	if err = os.Remove(templatePath); err != nil {
		t.Fatal(err)
	}
	if err = RemoveUnusedAttributeView(id); err != nil {
		t.Fatal(err)
	}
	if GlobalUndoLog.Peek(tree.ID) != nil {
		t.Fatal("database cleanup left stale undo history")
	}
	if _, err = os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("unused database remains: %v", err)
	}
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-clean", "storage", "av", id+".json"))
	if err != nil || len(histories) != 1 {
		t.Fatalf("missing history: %v %v", histories, err)
	}
	if data, readErr := os.ReadFile(histories[0]); readErr != nil || !bytes.Equal(data, original) {
		t.Fatalf("history differs: %v", readErr)
	}
	if err = RemoveUnusedAttributeView(id); err == nil {
		t.Fatal("missing database was accepted")
	}
	if err = av.SaveAttributeView(av.NewAttributeView(id)); err != nil {
		t.Fatal(err)
	}
	GlobalUndoLog.Record(history)
	if removed := RemoveUnusedAttributeViews(); len(removed) != 1 {
		t.Fatalf("unexpected batch cleanup result: %v", removed)
	}
	if GlobalUndoLog.Peek(tree.ID) != nil {
		t.Fatal("batch database cleanup left stale undo history")
	}
	// 笔记本级数据库不参与全局清理。
	encryptedPath := filepath.Join(util.DataDir, fixture.box.ID, "storage", "av", id+".json")
	if err = os.MkdirAll(filepath.Dir(encryptedPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(encryptedPath, []byte("ciphertext"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = RemoveUnusedAttributeView(id); err == nil {
		t.Fatal("notebook database was accepted")
	}
	if data, readErr := os.ReadFile(encryptedPath); readErr != nil || string(data) != "ciphertext" {
		t.Fatalf("notebook database changed: %v", readErr)
	}
}
