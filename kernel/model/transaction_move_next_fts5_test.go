//go:build fts5

package model

import (
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func assertMoveNextOrder(t *testing.T, rootID string, ids ...string) {
	t.Helper()
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		t.Fatal(err)
	}
	var actual []string
	for node := tree.Root.FirstChild; node != nil; node = node.Next {
		if node.IsBlock() && node.Type != ast.NodeKramdownBlockIAL {
			actual = append(actual, node.ID)
		}
	}
	if !slices.Equal(actual, ids) {
		t.Fatalf("block order: got %v, want %v", actual, ids)
	}
}

func TestMoveNextIDOrderAndReplay(t *testing.T) {
	for _, crossTree := range []bool{false, true} {
		t.Run(map[bool]string{false: "same tree", true: "cross tree"}[crossTree], func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			const (
				outside  = "20260928000001-outside"
				anchor   = "20260928000002-heading"
				child    = "20260928000003-child00"
				boundary = "20260928000004-boundar"
				first    = "20260928000005-first00"
				second   = "20260928000006-second0"
				end      = "20260928000007-end0000"
			)
			heading := newFoldMoveTestHeading(anchor, 2)
			targetID := fixture.sourceID
			sourceNodes := []*ast.Node{treenode.NewParagraph(outside)}
			targetNodes := []*ast.Node{heading, treenode.NewParagraph(child), newFoldMoveTestHeading(boundary, 2)}
			if crossTree {
				targetID = fixture.targetID
				writeFoldMoveTestTree(t, targetID, targetNodes...)
			} else {
				sourceNodes = append(sourceNodes, targetNodes...)
			}
			sourceNodes = append(sourceNodes, treenode.NewParagraph(first), treenode.NewParagraph(second), treenode.NewParagraph(end))
			writeFoldMoveTestTree(t, fixture.sourceID, sourceNodes...)
			forward := &Transaction{DoOperations: []*Operation{
				{Action: "move", ID: second, NextID: anchor, PreviousID: fixture.sourceID, ParentID: "missing"},
				{Action: "move", ID: first, NextID: second, PreviousID: fixture.sourceID, ParentID: "missing"},
			}, UndoOperations: []*Operation{
				{Action: "move", ID: first, NextID: end},
				{Action: "move", ID: second, NextID: end},
			}}
			for step := 0; step < 3; step++ {
				tx := forward
				if step == 1 {
					tx = &Transaction{DoOperations: cloneOperations(forward.UndoOperations)}
					tx.MarkReplay()
				} else if step == 2 {
					tx = &Transaction{DoOperations: cloneOperations(forward.DoOperations)}
					tx.MarkReplay()
				}
				if err := PerformTxSync(tx); err != nil {
					t.Fatalf("step %d: %v", step, err)
				}
				if crossTree {
					if step == 1 {
						assertMoveNextOrder(t, fixture.sourceID, outside, first, second, end)
						assertMoveNextOrder(t, targetID, anchor, child, boundary)
					} else {
						assertMoveNextOrder(t, fixture.sourceID, outside, end)
						assertMoveNextOrder(t, targetID, first, second, anchor, child, boundary)
					}
				} else if step == 1 {
					assertMoveNextOrder(t, targetID, outside, anchor, child, boundary, first, second, end)
				} else {
					assertMoveNextOrder(t, targetID, outside, first, second, anchor, child, boundary, end)
				}
			}
		})
	}
}

func TestMoveNextIDFoldedHeading(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	const (
		heading  = "20260928000101-heading"
		first    = "20260928000102-first00"
		second   = "20260928000103-second0"
		boundary = "20260928000104-boundar"
		anchor   = "20260928000105-anchor0"
	)
	writeFoldMoveTestTree(t, fixture.sourceID, newFoldMoveTestHeading(heading, 2),
		treenode.NewParagraph(first), treenode.NewParagraph(second), newFoldMoveTestHeading(boundary, 2))
	writeFoldMoveTestTree(t, fixture.targetID, treenode.NewParagraph(anchor))
	forward := &Transaction{DoOperations: []*Operation{{Action: "move", ID: heading, NextID: anchor,
		Context: map[string]any{moveGroupIDContextKey: "next-heading"}}},
		UndoOperations: []*Operation{{Action: "move", ID: heading, NextID: boundary,
			Context: map[string]any{moveGroupIDContextKey: "next-heading"}}}}
	if err := PerformTxSync(forward); err != nil {
		t.Fatal(err)
	}
	assertMoveNextOrder(t, fixture.sourceID, boundary)
	assertMoveNextOrder(t, fixture.targetID, heading, first, second, anchor)
	if !slices.Equal(forward.DoOperations[0].BlockIDs, []string{first, second}) {
		t.Fatal("folded move group was not captured")
	}
	undo := &Transaction{DoOperations: cloneOperations(forward.UndoOperations)}
	undo.MarkReplay()
	if err := PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	assertMoveNextOrder(t, fixture.sourceID, heading, first, second, boundary)
	assertMoveNextOrder(t, fixture.targetID, anchor)
	for _, target := range []string{heading, first} {
		// 移向自身或下辖块不能破坏标题移动集合。
		_ = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "move", ID: heading, NextID: target}}})
		assertMoveNextOrder(t, fixture.sourceID, heading, first, second, boundary)
	}
}
