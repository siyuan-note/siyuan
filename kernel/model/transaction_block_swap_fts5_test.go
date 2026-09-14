//go:build fts5

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestBlockSwapTransactionUndoRedo(t *testing.T) {
	for _, kind := range []string{"heading", "list", "bothLists"} {
		for _, sameTree := range []bool{false, true} {
			for _, children := range []bool{false, true} {
				for _, embed := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/same=%t/children=%t/embed=%t", kind, sameTree, children, embed), func(t *testing.T) {
						testBlockSwapTransactionUndoRedo(t, kind, sameTree, children, embed)
					})
				}
			}
		}
	}
}

func TestBlockSwapTransactionWriteFailure(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	before := captureBlockSwapFragments([]*parse.Tree{source, target})
	op := &Operation{Action: "swapBlockRef", ID: source.Root.FirstChild.ID, BlockID: target.Root.FirstChild.ID,
		Data: map[string]bool{"includeChildren": false, "originalToEmbed": true}}
	tx := &Transaction{DoOperations: []*Operation{op}, m: &sync.Mutex{}}
	if err = tx.begin(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if tx.state.Load() == 1 {
			tx.rollback()
		}
	}()
	if txErr := tx.doSwapBlockRef(op); txErr != nil {
		t.Fatal(txErr)
	}
	writes := 0
	injected := errors.New("injected second document write failure")
	tx.writeTransactionTree = func(tree *parse.Tree) error {
		writes++
		if writes == 2 {
			return injected
		}
		return writeTreeUpsertQueue(tree)
	}
	if err = tx.commit(); !errors.Is(err, injected) {
		t.Fatalf("unexpected commit result: %v", err)
	}
	tx.rollback()
	var actual []*parse.Tree
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		tree, loadErr := LoadTreeByBlockID(id)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		actual = append(actual, tree)
	}
	assertBlockSwapFragments(t, before, captureBlockSwapFragments(actual))
}

func TestBlockSwapTransactionRejectsInvalidRequests(t *testing.T) {
	for _, data := range []any{nil, "invalid", map[string]any{"includeChildren": true},
		map[string]any{"includeChildren": 1, "originalToEmbed": false}} {
		op := &Operation{Action: "swapBlockRef", Data: data}
		tx := &Transaction{DoOperations: []*Operation{op}}
		if err := tx.doSwapBlockRef(op); err == nil {
			t.Fatalf("invalid request accepted: %v", data)
		}
	}
	op := &Operation{Action: "swapBlockRef"}
	tx := &Transaction{DoOperations: []*Operation{op}, isReplay: true}
	if err := tx.doSwapBlockRef(op); err == nil {
		t.Fatal("replay without internal snapshot accepted")
	}
	parent := treenode.NewParagraph("")
	child := treenode.NewParagraph("")
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(parent)
	parent.AppendChild(child)
	if validateBlockSwap(parent, child, false) == nil || validateBlockSwap(child, child, false) == nil ||
		validateBlockSwap(parent, root, false) == nil {
		t.Fatal("overlapping or document swap accepted")
	}
}

func testBlockSwapTransactionUndoRedo(t *testing.T, kind string, sameTree, children, embed bool) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	previousUndoLog := GlobalUndoLog
	GlobalUndoLog = newUndoLog(64)
	t.Cleanup(func() { GlobalUndoLog = previousUndoLog })
	refTree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	defTree, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	if sameTree {
		defTree = refTree
	}
	ref := treenode.NewParagraph("")
	def := treenode.NewParagraph("")
	if kind == "heading" {
		def.Type, def.HeadingLevel = ast.NodeHeading, 1
		def.SetIALAttr("fold", "1")
	}
	def.SetIALAttr("custom-avs", "20260914100000-av00001")
	def.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Secret definition")})
	ref.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: def.ID,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Secret definition"})
	child := treenode.NewParagraph("")
	child.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Child")})
	refTree.Root.AppendChild(ref)
	defTree.Root.AppendChild(def)
	defTree.Root.AppendChild(child)
	wrap := func(node *ast.Node) *ast.Node {
		list := &ast.Node{Type: ast.NodeList, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 0, BulletChar: '*'}}
		item := &ast.Node{Type: ast.NodeListItem, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 0, BulletChar: '*'}}
		list.SetIALAttr("id", list.ID)
		item.SetIALAttr("id", item.ID)
		node.InsertBefore(list)
		list.AppendChild(item)
		item.AppendChild(node)
		return list
	}
	if kind != "heading" {
		list := wrap(def)
		list.FirstChild.AppendChild(wrap(child))
	}
	if kind == "bothLists" {
		wrap(ref)
	}
	for _, tree := range []*parse.Tree{refTree, defTree} {
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	load := func() []*parse.Tree {
		var trees []*parse.Tree
		for _, id := range []string{fixture.sourceID, fixture.targetID} {
			tree, loadErr := LoadTreeByBlockID(id)
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			trees = append(trees, tree)
		}
		return trees
	}
	before := captureBlockSwapFragments(load())
	tx := &Transaction{DoOperations: []*Operation{{Action: "swapBlockRef", ID: ref.ID, BlockID: def.ID,
		Data: map[string]bool{"includeChildren": children, "originalToEmbed": embed}}}}
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil || (!sameTree && entry != GlobalUndoLog.Peek(fixture.targetID)) {
		t.Fatal("cross-document conversion did not share an undo entry")
	}
	after := captureBlockSwapFragments(load())
	data, err := json.Marshal(tx)
	if err != nil || strings.Contains(string(data), "Secret definition") {
		t.Fatalf("undo snapshots leaked into response: %s, %v", data, err)
	}
	for cycle := 0; cycle < 2; cycle++ {
		replay := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
		replay.MarkReplay()
		if err = PerformTxSync(replay); err != nil {
			t.Fatalf("undo failed: %v", err)
		}
		assertBlockSwapFragments(t, before, captureBlockSwapFragments(load()))
		replay = &Transaction{DoOperations: entry.DoOperationsForReplay()}
		replay.MarkReplay()
		if err = PerformTxSync(replay); err != nil {
			t.Fatalf("redo failed: %v", err)
		}
		assertBlockSwapFragments(t, after, captureBlockSwapFragments(load()))
	}
	modified, err := LoadTreeByBlockID(def.ID)
	if err != nil {
		t.Fatal(err)
	}
	treenode.GetNodeInTree(modified, def.ID).FirstChild.Tokens = []byte("Newer edit")
	if _, err = filesys.WriteTree(modified); err != nil {
		t.Fatal(err)
	}
	beforeConflict := captureBlockSwapFragments(load())
	replay := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
	replay.MarkReplay()
	if err = PerformTxSync(replay); err == nil {
		t.Fatal("undo overwrote newer content")
	}
	assertBlockSwapFragments(t, beforeConflict, captureBlockSwapFragments(load()))
}
