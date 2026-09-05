// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build fts5

package model

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const templateDocTreeTransactionTestEnv = "SIYUAN_TEST_TEMPLATE_DOC_TREE_TRANSACTION"

func TestTemplateDocTreeTransactionUndoRedo(t *testing.T) {
	if runTemplateDocTreeTransactionTestInSubprocess(t) {
		return
	}
	fixture := setupTemplateDocTreeTransactionTest(t)
	clearTemplateDocTreePlansForTest()
	GlobalUndoLog.Clear("")
	t.Cleanup(func() {
		clearTemplateDocTreePlansForTest()
		GlobalUndoLog.Clear("")
	})
	templatePath := writeTemplateDocTreeTestFile(t, `.action{define "document-content"}
# .action{.title}
Parent: .action{.parentID}
Later sibling: .action{renderDocRef "path" "/复盘"}
.action{end}
.action{createDocTree (list
  (dict "title" "资料" "define" "document-content"
    "children" (list (dict "title" "摘录")))
  (dict "title" "复盘")
)}
Child: .action{renderDocRef "path" "/资料"}`)
	_, dom, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document tree plan failed: %v", err)
	}
	if nil == summary {
		t.Fatal("render document tree plan returned no summary")
	}
	if 3 != summary.Count || 3 != len(summary.Nodes) {
		t.Fatalf("unexpected document tree plan: %+v", summary)
	}
	for _, node := range summary.Nodes {
		node := node
		t.Cleanup(func() {
			cache.RemoveTreeData(node.ID)
			cache.RemoveDocIAL(node.path)
			treenode.RemoveBlockTreesByRootID(fixture.box.ID, node.ID)
		})
	}

	transaction, insertedID := newTemplateDocTreeRenderedInsertTransaction(summary.ID, fixture.sourceID, dom)
	attached, err := AttachTemplateDocTreePlans([]*Transaction{transaction})
	if nil != err || !attached {
		t.Fatalf("attach document tree plan failed: attached=%t, err=%v", attached, err)
	}
	transaction.MarkFromAPI()
	if err = PerformTxSync(transaction); nil != err {
		t.Fatalf("apply document tree transaction failed: %v", err)
	}
	assertTemplateDocTreeApplied(t, fixture, summary, insertedID)

	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if nil == entry {
		t.Fatal("document tree transaction was not recorded in the undo log")
	}
	mutatedRootIDs := map[string]bool{}
	for _, rootID := range entry.MutatedRootIDs() {
		mutatedRootIDs[rootID] = true
	}
	if 1+summary.Count != len(mutatedRootIDs) || !mutatedRootIDs[fixture.sourceID] {
		t.Fatalf("unexpected document tree undo roots: %v", entry.MutatedRootIDs())
	}
	for _, node := range summary.Nodes {
		if !mutatedRootIDs[node.ID] {
			t.Fatalf("created document [%s] is missing from the undo entry", node.ID)
		}
	}

	entry = GlobalUndoLog.Undo(fixture.sourceID)
	if nil == entry {
		t.Fatal("document tree transaction could not be popped for undo")
	}
	undoTransaction := &Transaction{
		DoOperations:   entry.UndoOperationsForReplay(),
		UndoOperations: entry.DoOperationsForReplay(),
	}
	undoTransaction.MarkReplay()
	ResolveReplayDuplicateIds(undoTransaction)
	if err = PerformTxSync(undoTransaction); nil != err {
		GlobalUndoLog.UndoRollback(entry, fixture.sourceID)
		t.Fatalf("undo document tree transaction failed: %v", err)
	}
	GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
	assertTemplateDocTreeRemoved(t, fixture, summary, insertedID)

	entry = GlobalUndoLog.Redo(fixture.sourceID)
	if nil == entry {
		t.Fatal("document tree transaction could not be popped for redo")
	}
	redoTransaction := &Transaction{
		DoOperations:   entry.DoOperationsForReplay(),
		UndoOperations: entry.UndoOperationsForReplay(),
	}
	redoTransaction.MarkReplay()
	ResolveReplayDuplicateIds(redoTransaction)
	if err = PerformTxSync(redoTransaction); nil != err {
		GlobalUndoLog.RedoRollback(entry, fixture.sourceID)
		t.Fatalf("redo document tree transaction failed: %v", err)
	}
	GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
	assertTemplateDocTreeApplied(t, fixture, summary, insertedID)
}

func TestTemplateDocTreeTransactionFailureCleansCreatedDocuments(t *testing.T) {
	if runTemplateDocTreeTransactionTestInSubprocess(t) {
		return
	}
	fixture := setupTemplateDocTreeTransactionTest(t)
	clearTemplateDocTreePlansForTest()
	GlobalUndoLog.Clear("")
	t.Cleanup(func() {
		clearTemplateDocTreePlansForTest()
		GlobalUndoLog.Clear("")
	})
	templatePath := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list
  (dict "title" "资料")
  (dict "title" "复盘")
)}`)
	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document tree plan failed: %v", err)
	}
	if nil == summary {
		t.Fatal("render document tree plan returned no summary")
	}
	value, ok := templateDocTreePlans.Load(summary.ID)
	if !ok {
		t.Fatalf("document tree plan [%s] was not stored", summary.ID)
	}
	plan := value.(*templateDocTreePlan)
	plan.trees[len(plan.trees)-1].Path = "/\x00/invalid.sy"
	for _, node := range summary.Nodes {
		node := node
		t.Cleanup(func() {
			cache.RemoveTreeData(node.ID)
			cache.RemoveDocIAL(node.path)
			treenode.RemoveBlockTreesByRootID(fixture.box.ID, node.ID)
		})
	}

	transaction, insertedID := newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	attached, err := AttachTemplateDocTreePlans([]*Transaction{transaction})
	if nil != err || !attached {
		t.Fatalf("attach document tree plan failed: attached=%t, err=%v", attached, err)
	}
	transaction.MarkFromAPI()
	if err = PerformTxSync(transaction); nil == err {
		t.Fatal("invalid child document path did not fail the transaction")
	}
	parentTree, loadErr := LoadTreeByBlockID(fixture.sourceID)
	if nil != loadErr {
		t.Fatalf("load parent document after failed transaction failed: %v", loadErr)
	}
	if nil != treenode.GetNodeInTree(parentTree, insertedID) || nil != treenode.GetBlockTree(insertedID) {
		t.Fatalf("failed transaction retained parent template block [%s]", insertedID)
	}
	for _, node := range summary.Nodes {
		if nil != treenode.GetBlockTree(node.ID) || fixture.box.Exist(node.path) {
			t.Fatalf("failed transaction retained created document [%s]", node.ID)
		}
	}
	if nil != GlobalUndoLog.Peek(fixture.sourceID) {
		t.Fatal("failed document tree transaction was recorded in the undo log")
	}
}

func TestTemplateDocTreeTransactionUndoFailureIsCompensated(t *testing.T) {
	if runTemplateDocTreeTransactionTestInSubprocess(t) {
		return
	}
	fixture := setupTemplateDocTreeTransactionTest(t)
	clearTemplateDocTreePlansForTest()
	GlobalUndoLog.Clear("")
	t.Cleanup(func() {
		clearTemplateDocTreePlansForTest()
		GlobalUndoLog.Clear("")
	})
	templatePath := writeTemplateDocTreeTestFile(t, `.action{define "document-content"}
# .action{.title}
Parent: .action{.parentID}
Later sibling: .action{renderDocRef "path" "/复盘"}
.action{end}
.action{createDocTree (list
  (dict "title" "资料" "define" "document-content")
  (dict "title" "复盘")
)}
Child: .action{renderDocRef "path" "/资料"}`)
	_, dom, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document tree plan failed: %v", err)
	}
	if nil == summary || 2 != summary.Count {
		t.Fatalf("unexpected document tree plan: %+v", summary)
	}
	cleanupTemplateDocTreeTestNodes(t, fixture, summary)

	transaction, insertedID := newTemplateDocTreeRenderedInsertTransaction(summary.ID, fixture.sourceID, dom)
	attached, err := AttachTemplateDocTreePlans([]*Transaction{transaction})
	if nil != err || !attached {
		t.Fatalf("attach document tree plan failed: attached=%t, err=%v", attached, err)
	}
	transaction.MarkFromAPI()
	if err = PerformTxSync(transaction); nil != err {
		t.Fatalf("apply document tree transaction failed: %v", err)
	}
	assertTemplateDocTreeApplied(t, fixture, summary, insertedID)

	for _, failAt := range []int{1, 2} {
		entry := GlobalUndoLog.Undo(fixture.sourceID)
		if nil == entry {
			t.Fatalf("document tree transaction could not be popped for undo failure at removal %d", failAt)
		}
		undoTransaction := &Transaction{
			DoOperations:   entry.UndoOperationsForReplay(),
			UndoOperations: entry.DoOperationsForReplay(),
		}
		undoTransaction.MarkReplay()
		ResolveReplayDuplicateIds(undoTransaction)
		removeCount := 0
		undoTransaction.removeCreatedDoc = func(box *Box, documentPath string, luteEngine *lute.Lute) (*parse.Tree, error) {
			removeCount++
			if failAt == removeCount {
				return nil, errors.New("injected created document removal failure")
			}
			return removeDoc(box, documentPath, luteEngine)
		}
		if err = PerformTxSync(undoTransaction); nil == err {
			GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
			t.Fatalf("undo unexpectedly succeeded when removal %d should fail", failAt)
		}
		GlobalUndoLog.UndoRollback(entry, fixture.sourceID)
		if failAt != removeCount {
			t.Fatalf("unexpected removal count after injected failure: got %d, want %d", removeCount, failAt)
		}
		assertTemplateDocTreeApplied(t, fixture, summary, insertedID)
	}

	entry := GlobalUndoLog.Undo(fixture.sourceID)
	if nil == entry {
		t.Fatal("document tree transaction could not be retried after compensated undo failures")
	}
	undoTransaction := &Transaction{
		DoOperations:   entry.UndoOperationsForReplay(),
		UndoOperations: entry.DoOperationsForReplay(),
	}
	undoTransaction.MarkReplay()
	ResolveReplayDuplicateIds(undoTransaction)
	if err = PerformTxSync(undoTransaction); nil != err {
		GlobalUndoLog.UndoRollback(entry, fixture.sourceID)
		t.Fatalf("retry undo after compensated failures failed: %v", err)
	}
	GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
	assertTemplateDocTreeRemoved(t, fixture, summary, insertedID)

	entry = GlobalUndoLog.Redo(fixture.sourceID)
	if nil == entry {
		t.Fatal("document tree transaction could not be popped for redo failure injection")
	}
	redoTransaction := &Transaction{
		DoOperations:   entry.DoOperationsForReplay(),
		UndoOperations: entry.UndoOperationsForReplay(),
	}
	redoTransaction.MarkReplay()
	ResolveReplayDuplicateIds(redoTransaction)
	writeCount := 0
	redoTransaction.writeTransactionTree = func(tree *parse.Tree) error {
		writeCount++
		if summary.Count+1 == writeCount {
			return errors.New("injected parent document write failure")
		}
		return writeTreeUpsertQueue(tree)
	}
	if err = PerformTxSync(redoTransaction); nil == err {
		GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
		t.Fatal("redo unexpectedly succeeded when the parent document write should fail")
	}
	GlobalUndoLog.RedoRollback(entry, fixture.sourceID)
	if summary.Count+1 != writeCount {
		t.Fatalf("unexpected write count after injected parent failure: got %d, want %d", writeCount, summary.Count+1)
	}
	assertTemplateDocTreeRemoved(t, fixture, summary, insertedID)

	entry = GlobalUndoLog.Redo(fixture.sourceID)
	if nil == entry {
		t.Fatal("document tree transaction could not be retried after compensated redo failure")
	}
	redoTransaction = &Transaction{
		DoOperations:   entry.DoOperationsForReplay(),
		UndoOperations: entry.UndoOperationsForReplay(),
	}
	redoTransaction.MarkReplay()
	ResolveReplayDuplicateIds(redoTransaction)
	if err = PerformTxSync(redoTransaction); nil != err {
		GlobalUndoLog.RedoRollback(entry, fixture.sourceID)
		t.Fatalf("retry redo after compensated failure failed: %v", err)
	}
	GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
	assertTemplateDocTreeApplied(t, fixture, summary, insertedID)
}

func TestTemplateDocTreeTransactionPreservesExistingTargetPath(t *testing.T) {
	if runTemplateDocTreeTransactionTestInSubprocess(t) {
		return
	}
	fixture := setupTemplateDocTreeTransactionTest(t)
	clearTemplateDocTreePlansForTest()
	GlobalUndoLog.Clear("")
	t.Cleanup(func() {
		clearTemplateDocTreePlansForTest()
		GlobalUndoLog.Clear("")
	})
	templatePath := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list
  (dict "title" "资料")
)}`)
	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document tree plan failed: %v", err)
	}
	if nil == summary || 1 != summary.Count {
		t.Fatalf("unexpected document tree plan: %+v", summary)
	}
	cleanupTemplateDocTreeTestNodes(t, fixture, summary)

	transaction, insertedID := newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	attached, err := AttachTemplateDocTreePlans([]*Transaction{transaction})
	if nil != err || !attached {
		t.Fatalf("attach document tree plan failed: attached=%t, err=%v", attached, err)
	}
	targetPath := filepath.Join(util.DataDir, fixture.box.ID, summary.Nodes[0].path)
	if err = os.MkdirAll(filepath.Dir(targetPath), 0755); nil != err {
		t.Fatalf("create existing target directory failed: %v", err)
	}
	original := []byte("pre-existing document bytes")
	if err = os.WriteFile(targetPath, original, 0644); nil != err {
		t.Fatalf("create existing target file failed: %v", err)
	}

	transaction.MarkFromAPI()
	if err = PerformTxSync(transaction); nil == err {
		t.Fatal("existing created document target path did not fail the transaction")
	}
	actual, readErr := os.ReadFile(targetPath)
	if nil != readErr {
		t.Fatalf("read existing target file after failed transaction failed: %v", readErr)
	}
	if string(original) != string(actual) {
		t.Fatalf("failed transaction changed existing target bytes: got %q, want %q", actual, original)
	}
	parentTree, loadErr := LoadTreeByBlockID(fixture.sourceID)
	if nil != loadErr {
		t.Fatalf("load parent document after failed transaction failed: %v", loadErr)
	}
	if nil != treenode.GetNodeInTree(parentTree, insertedID) || nil != treenode.GetBlockTree(insertedID) {
		t.Fatalf("failed transaction retained parent template block [%s]", insertedID)
	}
	if nil != treenode.GetBlockTree(summary.Nodes[0].ID) {
		t.Fatalf("failed transaction indexed the pre-existing target as planned document [%s]", summary.Nodes[0].ID)
	}
	if nil != GlobalUndoLog.Peek(fixture.sourceID) {
		t.Fatal("failed document tree transaction was recorded in the undo log")
	}
}

func cleanupTemplateDocTreeTestNodes(t *testing.T, fixture *fileOperationTestFixture,
	summary *TemplateDocTreePlanSummary) {
	t.Helper()
	for _, node := range summary.Nodes {
		node := node
		t.Cleanup(func() {
			cache.RemoveTreeData(node.ID)
			cache.RemoveDocIAL(node.path)
			treenode.RemoveBlockTreesByRootID(fixture.box.ID, node.ID)
		})
	}
}

func runTemplateDocTreeTransactionTestInSubprocess(t *testing.T) bool {
	t.Helper()
	if "1" == os.Getenv(templateDocTreeTransactionTestEnv) {
		return false
	}
	command := exec.Command(os.Args[0], "-test.run=^"+regexp.QuoteMeta(t.Name())+"$", "-test.v")
	command.Env = append(os.Environ(), templateDocTreeTransactionTestEnv+"=1")
	output, err := command.CombinedOutput()
	if nil != err {
		t.Fatalf("document tree transaction subprocess failed: %v\n%s", err, output)
	}
	return true
}

func setupTemplateDocTreeTransactionTest(t *testing.T) *fileOperationTestFixture {
	t.Helper()
	fixture := setupStructureTransactionTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	originalTempDir := util.TempDir
	originalQueueDir := util.QueueDir
	originalConfDir := util.ConfDir
	originalHistoryDir := util.HistoryDir
	originalDBPath := util.DBPath
	originalHistoryDBPath := util.HistoryDBPath
	originalAssetContentDBPath := util.AssetContentDBPath
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.ConfDir = filepath.Join(util.TempDir, "conf")
	util.HistoryDir = filepath.Join(util.TempDir, "history")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.QueueDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); nil != err {
			t.Fatalf("create transaction test directory [%s] failed: %v", dir, err)
		}
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	for _, documentPath := range []string{fixture.sourcePath, fixture.targetPath} {
		tree, err := filesys.LoadTree(fixture.box.ID, documentPath, util.NewLute())
		if nil != err {
			t.Fatalf("reload transaction fixture document [%s] failed: %v", documentPath, err)
		}
		treenode.UpsertBlockTree(tree)
	}
	t.Cleanup(func() {
		time.Sleep(700 * time.Millisecond)
		sql.FlushQueue()
		sql.FlushHistoryQueue()
		sql.FlushAssetContentQueue()
		sql.CloseDatabase()
		util.TempDir = originalTempDir
		util.QueueDir = originalQueueDir
		util.ConfDir = originalConfDir
		util.HistoryDir = originalHistoryDir
		util.DBPath = originalDBPath
		util.HistoryDBPath = originalHistoryDBPath
		util.AssetContentDBPath = originalAssetContentDBPath
	})
	return fixture
}

func assertTemplateDocTreeApplied(t *testing.T, fixture *fileOperationTestFixture,
	summary *TemplateDocTreePlanSummary, insertedID string) {
	t.Helper()
	parentTree, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("load parent document failed: %v", err)
	}
	if nil == treenode.GetNodeInTree(parentTree, insertedID) {
		t.Fatalf("parent template block [%s] was not applied", insertedID)
	}
	nodesByTitle := map[string]*TemplateDocTreeNode{}
	for _, node := range summary.Nodes {
		nodesByTitle[node.Title] = node
		blockTree := treenode.GetBlockTree(node.ID)
		if nil == blockTree {
			t.Fatalf("created document block tree [%s] was not found", node.ID)
		}
		if node.path != blockTree.Path || node.HPath != blockTree.HPath || !fixture.box.Exist(blockTree.Path) {
			t.Fatalf("created document has an unexpected location: node=%+v, blockTree=%+v", node, blockTree)
		}
		createdTree, loadErr := LoadTreeByBlockID(node.ID)
		if nil != loadErr || node.Title != createdTree.Root.IALAttr("title") {
			t.Fatalf("load created document [%s] failed or returned an unexpected title: %v", node.ID, loadErr)
		}
	}
	contentTree, err := LoadTreeByBlockID(summary.Nodes[0].ID)
	if nil != err {
		t.Fatalf("load defined child template content failed: %v", err)
	}
	contentText := contentTree.Root.Text()
	if !strings.Contains(contentText, summary.Nodes[0].Title) || !strings.Contains(contentText, fixture.sourceID) {
		t.Fatalf("defined child template did not use the child context: %q", contentText)
	}
	assertTemplateDocTreeRef(t, parentTree, nodesByTitle["资料"].ID, "parent document")
	assertTemplateDocTreeRef(t, contentTree, nodesByTitle["复盘"].ID, "earlier sibling template")
}

func assertTemplateDocTreeRef(t *testing.T, tree *parse.Tree, defID, source string) {
	t.Helper()
	for _, id := range getRefDefIDs(tree.Root) {
		if defID == id {
			return
		}
	}
	t.Fatalf("%s block reference to planned document [%s] was degraded", source, defID)
}

func newTemplateDocTreeRenderedInsertTransaction(planID, parentID, dom string) (*Transaction, string) {
	tree := util.NewLute().BlockDOM2Tree(dom)
	insertedID := tree.Root.FirstChild.ID
	return &Transaction{
		TemplateDocTreePlanID: planID,
		DoOperations: []*Operation{{
			Action: "insert", ID: insertedID, ParentID: parentID, Data: dom,
		}},
		UndoOperations: []*Operation{{Action: "delete", ID: insertedID}},
	}, insertedID
}

func assertTemplateDocTreeRemoved(t *testing.T, fixture *fileOperationTestFixture,
	summary *TemplateDocTreePlanSummary, insertedID string) {
	t.Helper()
	parentTree, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("load parent document after undo failed: %v", err)
	}
	if nil != treenode.GetNodeInTree(parentTree, insertedID) {
		t.Fatalf("parent template block [%s] remained after undo", insertedID)
	}
	for _, node := range summary.Nodes {
		if nil != treenode.GetBlockTree(node.ID) || fixture.box.Exist(node.path) {
			t.Fatalf("created document [%s] remained after undo", node.ID)
		}
	}
}
