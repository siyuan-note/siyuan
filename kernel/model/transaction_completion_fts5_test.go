//go:build fts5

package model

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestTransactionCompletionWaitsForUndoRecordAndCleanup(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	previous := GlobalUndoLog
	log := newUndoLog(64)
	GlobalUndoLog = log
	t.Cleanup(func() { GlobalUndoLog = previous })
	log.mu.Lock()
	locked := true
	defer func() {
		if locked {
			log.mu.Unlock()
		}
		FlushTxQueue()
	}()
	tx := &Transaction{
		DoOperations: []*Operation{{Action: "update", ID: fixture.childID,
			Data: fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">Committed text</div></div>`, fixture.childID)}},
		UndoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: "Original text"}},
	}
	tx.MarkFromAPI()
	transactions := []*Transaction{tx}
	PerformTransactions(&transactions)
	waiter := waitForTransactionInTest(tx)
	deadline := time.Now().Add(5 * time.Second)
	for tx.state.Load() != 2 {
		if time.Now().After(deadline) {
			t.Fatal("transaction did not reach its committed state")
		}
		time.Sleep(time.Millisecond)
	}
	// 写盘成功但撤销日志尚未记录时，完成等待不能放行。
	requireTransactionWaiting(t, waiter)
	log.mu.Unlock()
	locked = false
	requireTransactionFinished(t, waiter)
	canUndo, _, _ := log.State(fixture.sourceID)
	if !canUndo || !slices.Equal(tx.GetChangedRootIDs(), []string{fixture.sourceID}) || tx.trees != nil || tx.nodes != nil {
		t.Fatal("completion was published before undo state and released resources were ready")
	}
	tree, err := LoadTreeByBlockID(fixture.childID)
	if err != nil || treenode.GetNodeInTree(tree, fixture.childID).Text() != "Committed text" {
		t.Fatalf("completed transaction did not persist its content: %v", err)
	}
}
