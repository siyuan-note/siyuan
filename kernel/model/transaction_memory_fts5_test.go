//go:build fts5

package model

import (
	"fmt"
	"runtime"
	"slices"
	"testing"
	"time"
	"weak"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCompletedTransactionBatchReleasesDocumentTrees(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	originalUndoLog := GlobalUndoLog
	GlobalUndoLog = newUndoLog(64)
	t.Cleanup(func() { GlobalUndoLog = originalUndoLog })

	dom := func(index int) string {
		return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">edit %d</div></div>`, fixture.childID, index)
	}
	var roots []weak.Pointer[ast.Node]
	transactions := make([]*Transaction, 8)
	for i := range transactions {
		tx := &Transaction{
			DoOperations:   []*Operation{{Action: "update", ID: fixture.childID, Data: dom(i)}},
			UndoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom(i - 1)}},
			writeTransactionTree: func(tree *parse.Tree) error {
				roots = append(roots, weak.Make(tree.Root))
				return writeTreeUpsertQueue(tree)
			},
		}
		tx.MarkFromAPI()
		transactions[i] = tx
	}
	PerformTransactions(&transactions)
	FlushTxQueue()
	// 保持整批响应和撤销日志可达，只排空索引队列，验证已完成事务不再持有旧文档树。
	sql.FlushQueue()
	if len(roots) != len(transactions) {
		t.Fatalf("committed %d document trees for %d transactions", len(roots), len(transactions))
	}
	// 父文档信息刷新会短暂持有树，等待延迟任务结束后再检查回收。
	deadline := time.Now().Add(3 * time.Second)
	for {
		runtime.GC()
		retained := -1
		for index, root := range roots {
			if root.Value() != nil {
				retained = index
				break
			}
		}
		if retained < 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("completed transaction %d still retains its document tree", retained)
		}
		time.Sleep(10 * time.Millisecond)
	}
	for _, tx := range transactions {
		if tx.state.Load() != 2 || !slices.Equal(tx.GetChangedRootIDs(), []string{fixture.sourceID}) ||
			!slices.Equal(tx.GetMutatedRootIDs(), []string{fixture.sourceID}) {
			t.Fatal("releasing document trees changed committed transaction metadata")
		}
	}
	runtime.KeepAlive(transactions)

	assertText := func(want string) {
		t.Helper()
		tree, err := LoadTreeByBlockID(fixture.childID)
		if err != nil {
			t.Fatal(err)
		}
		if actual := treenode.GetNodeInTree(tree, fixture.childID).Text(); actual != want {
			t.Fatalf("persisted block text = %q, want %q", actual, want)
		}
	}
	assertText("edit 7")
	entry := GlobalUndoLog.Undo(fixture.sourceID)
	if entry == nil {
		t.Fatal("committed transaction lost its undo entry")
	}
	undo := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
	undo.MarkReplay()
	if err := PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
	assertText("edit 6")
	entry = GlobalUndoLog.Redo(fixture.sourceID)
	if entry == nil {
		t.Fatal("undo lost its redo entry")
	}
	redo := &Transaction{DoOperations: entry.DoOperationsForReplay()}
	redo.MarkReplay()
	if err := PerformTxSync(redo); err != nil {
		t.Fatal(err)
	}
	GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
	assertText("edit 7")
	sql.FlushQueue()
}
