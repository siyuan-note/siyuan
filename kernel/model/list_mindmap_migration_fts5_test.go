//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMigrateLegacyMindmapsPersistsAndReplays(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	originalHistory := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = originalHistory })
	const codeID = "20260920000000-oldcode"
	dom := util.NewLute().Md2BlockDOM("```mindmap\n- Root\n  - [X] Child\n```\n{: id=\""+codeID+"\" name=\"keep\"}", false)
	if _, err := PerformBlockOperation(&Operation{Action: "appendInsert", ParentID: fixture.sourceID, Data: dom}); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourceID+".sy")
	before, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	tx, visible, err := MigrateLegacyMindmaps(fixture.sourceID)
	if err != nil || len(tx.DoOperations) != 1 || len(tx.UndoOperations) != 1 || visible[codeID] == "" {
		t.Fatalf("migration failed: %+v, %v", tx, err)
	}
	check := func(typ ast.NodeType) {
		t.Helper()
		cache.RemoveTreeData(fixture.sourceID)
		tree, loadErr := LoadTreeByBlockID(fixture.sourceID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		node := treenode.GetNodeInTree(tree, codeID)
		if node == nil || node.Type != typ || node.IALAttr("name") != "keep" {
			t.Fatalf("unexpected persisted node: %+v", node)
		}
	}
	check(ast.NodeList)
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil || len(entry.UndoOperationsForReplay()) != 1 || entry.UndoOperationsForReplay()[0].ID != codeID {
		t.Fatal("migration did not enter the document undo stack")
	}
	t.Cleanup(func() { GlobalUndoLog.Clear(fixture.sourceID) })
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", fixture.box.ID, fixture.sourceID+".sy"))
	if err != nil || len(histories) != 1 {
		t.Fatalf("missing history: %v, %v", histories, err)
	}
	history, err := os.ReadFile(histories[0])
	if err != nil || !bytes.Equal(before, history) {
		t.Fatalf("history did not preserve the original file: %v", err)
	}
	again, _, err := MigrateLegacyMindmaps(fixture.sourceID)
	if err != nil || len(again.DoOperations) != 0 {
		t.Fatalf("migration is not idempotent: %+v, %v", again, err)
	}
	for i, operations := range [][]*Operation{tx.UndoOperations, tx.DoOperations} {
		replay := &Transaction{DoOperations: operations}
		replay.MarkReplay()
		if err = PerformTxSync(replay); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			check(ast.NodeCodeBlock)
		} else {
			check(ast.NodeList)
		}
	}
}

func TestMigrateLegacyMindmapsHistoryFailureAndQueuedEdits(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	const codeID = "20260920000000-oldcode"
	engine := util.NewLute()
	dom := engine.Md2BlockDOM("- Parent\n\n  ```mindmap\n  - Original\n  ```\n  {: id=\""+codeID+"\"}\n", false)
	if _, err := PerformBlockOperation(&Operation{Action: "appendInsert", ParentID: fixture.sourceID, Data: dom}); err != nil {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	code := treenode.GetNodeInTree(tree, codeID)
	if code == nil {
		t.Fatal("nested fixture code was not created")
	}
	code.Parent.SetIALAttr("fold", "1")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(util.DataDir, fixture.box.ID, tree.Path)
	before, _ := os.ReadFile(sourcePath)
	originalHistory := util.HistoryDir
	util.HistoryDir = filepath.Join(t.TempDir(), "unwritable-history")
	if err = os.WriteFile(util.HistoryDir, []byte("file"), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err = MigrateLegacyMindmaps(fixture.sourceID)
	util.HistoryDir = originalHistory
	if err == nil {
		t.Fatal("migration continued without a recoverable history")
	}
	after, _ := os.ReadFile(sourcePath)
	if !bytes.Equal(before, after) {
		t.Fatal("failed history write modified the document")
	}
	newDOM := engine.Md2BlockDOM("```mindmap\n- Latest edit\n```\n{: id=\""+codeID+"\"}", false)
	queued := []*Transaction{{DoOperations: []*Operation{{Action: "update", ID: codeID, Data: newDOM}}}}
	PerformTransactions(&queued)
	tx, visible, err := MigrateLegacyMindmaps(fixture.sourceID)
	if err != nil || len(tx.DoOperations) != 1 || !strings.Contains(visible[codeID], "Latest edit") {
		t.Fatalf("migration missed folded content or queued edits: %v", err)
	}
	t.Cleanup(func() { GlobalUndoLog.Clear(fixture.sourceID) })
}
