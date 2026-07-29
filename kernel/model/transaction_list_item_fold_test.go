package model

import (
	"fmt"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func newFoldedListItemTree(blockCount int, task bool) (*parse.Tree, *ast.Node) {
	root := &ast.Node{Type: ast.NodeDocument, ID: "20260729000000-root001"}
	list := &ast.Node{Type: ast.NodeList, ID: "20260729000000-list001", ListData: &ast.ListData{Typ: 1}}
	item := &ast.Node{Type: ast.NodeListItem, ID: "20260729000000-item001", ListData: &ast.ListData{Typ: 1}}
	item.SetIALAttr("id", item.ID)
	item.SetIALAttr("fold", "1")
	if task {
		item.ListData.Typ = 3
		item.AppendChild(&ast.Node{Type: ast.NodeTaskListItemMarker})
	}
	for i := 0; i < blockCount; i++ {
		item.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: fmt.Sprintf("20260729000000-block%03d", i)})
	}
	item.AppendChild(&ast.Node{Type: ast.NodeKramdownBlockIAL})
	list.AppendChild(item)
	root.AppendChild(list)
	return &parse.Tree{
		Root: root,
		ID:   root.ID,
		Box:  "20260729000000-box0001",
		Path: "/20260729000000-root001.sy",
	}, item
}

func TestListItemDirectBlockCount(t *testing.T) {
	_, item := newFoldedListItemTree(1, true)
	if got := listItemDirectBlockCount(item); 1 != got {
		t.Fatalf("unexpected direct block count: got %d, want 1", got)
	}
}

func TestNormalizeListItemFoldsWithoutUndo(t *testing.T) {
	tree, item := newFoldedListItemTree(1, false)
	tx := &Transaction{DoOperations: []*Operation{{Action: "delete", ID: "20260729000000-deleted"}}}
	tx.markListItemFoldCandidate(item, tree)

	if ret := tx.normalizeListItemFolds(); nil != ret {
		t.Fatalf("normalize list item fold failed: %s", ret)
	}
	if 2 != len(tx.DoOperations) {
		t.Fatalf("missing generated do operation: got %d, want 2", len(tx.DoOperations))
	}
	if 0 != len(tx.UndoOperations) {
		t.Fatalf("generated an incomplete undo entry: got %d operations", len(tx.UndoOperations))
	}
}

func TestNormalizeListItemFoldsReversesGeneratedUndoOrder(t *testing.T) {
	firstTree, firstItem := newFoldedListItemTree(1, false)
	secondTree, secondItem := newFoldedListItemTree(1, false)
	secondItem.ID = "20260729000000-item002"
	secondItem.SetIALAttr("id", secondItem.ID)
	originalUndo := &Operation{Action: "insert", ID: "20260729000000-deleted"}
	tx := &Transaction{
		DoOperations:   []*Operation{{Action: "delete", ID: originalUndo.ID}},
		UndoOperations: []*Operation{originalUndo},
	}
	tx.markListItemFoldCandidate(firstItem, firstTree)
	tx.markListItemFoldCandidate(secondItem, secondTree)

	if ret := tx.normalizeListItemFolds(); nil != ret {
		t.Fatalf("normalize list item fold failed: %s", ret)
	}
	if firstItem.ID != tx.DoOperations[1].ID || secondItem.ID != tx.DoOperations[2].ID {
		t.Fatalf("generated do operation order changed: %s, %s", tx.DoOperations[1].ID, tx.DoOperations[2].ID)
	}
	if secondItem.ID != tx.UndoOperations[0].ID || firstItem.ID != tx.UndoOperations[1].ID ||
		originalUndo != tx.UndoOperations[2] {
		t.Fatalf("unexpected generated undo operation order: %s, %s, %s",
			tx.UndoOperations[0].ID, tx.UndoOperations[1].ID, tx.UndoOperations[2].ID)
	}
}

func TestNormalizeListItemFolds(t *testing.T) {
	tests := []struct {
		name          string
		blockCount    int
		wantFold      string
		wantGenerated bool
	}{
		{name: "empty", blockCount: 0, wantFold: "", wantGenerated: true},
		{name: "single block", blockCount: 1, wantFold: "", wantGenerated: true},
		{name: "multiple blocks", blockCount: 2, wantFold: "1", wantGenerated: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tree, item := newFoldedListItemTree(test.blockCount, false)
			originalDo := &Operation{Action: "delete", ID: "20260729000000-deleted"}
			originalUndo := &Operation{Action: "insert", ID: "20260729000000-deleted"}
			tx := &Transaction{
				DoOperations:   []*Operation{originalDo},
				UndoOperations: []*Operation{originalUndo},
			}
			tx.markListItemFoldCandidate(item, tree)
			tx.markListItemFoldCandidate(item, tree)

			if ret := tx.normalizeListItemFolds(); nil != ret {
				t.Fatalf("normalize list item fold failed: %s", ret)
			}
			if got := item.IALAttr("fold"); test.wantFold != got {
				t.Fatalf("unexpected fold: got %q, want %q", got, test.wantFold)
			}
			if 1 != len(tx.listItemFoldCandidates) {
				t.Fatalf("candidate was not deduplicated: got %d, want 1", len(tx.listItemFoldCandidates))
			}

			if !test.wantGenerated {
				if 1 != len(tx.DoOperations) || 1 != len(tx.UndoOperations) {
					t.Fatalf("unexpected generated operations: do %d, undo %d",
						len(tx.DoOperations), len(tx.UndoOperations))
				}
				return
			}
			if 2 != len(tx.DoOperations) || 2 != len(tx.UndoOperations) {
				t.Fatalf("missing generated operations: do %d, undo %d",
					len(tx.DoOperations), len(tx.UndoOperations))
			}
			generatedDo := tx.DoOperations[1]
			if "setAttrs" != generatedDo.Action || item.ID != generatedDo.ID || `{"fold":""}` != generatedDo.Data {
				t.Fatalf("unexpected generated do operation: %+v", generatedDo)
			}
			generatedUndo := tx.UndoOperations[0]
			if "setAttrs" != generatedUndo.Action || item.ID != generatedUndo.ID || `{"fold":"1"}` != generatedUndo.Data {
				t.Fatalf("unexpected generated undo operation: %+v", generatedUndo)
			}
			if originalUndo != tx.UndoOperations[1] {
				t.Fatal("generated undo operation was not prepended")
			}
		})
	}
}
