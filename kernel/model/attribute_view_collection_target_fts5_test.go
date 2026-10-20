//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestBlockCollectionTagTargets(t *testing.T) {
	newNode := func(typ ast.NodeType) *ast.Node { return &ast.Node{ID: ast.NewNodeID(), Type: typ} }
	tag := func(node *ast.Node, name string) {
		node.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: name})
	}
	for _, typ := range []ast.NodeType{ast.NodeList, ast.NodeBlockquote, ast.NodeCallout, ast.NodeSuperBlock,
		ast.NodeTabs, ast.NodeTabItem, ast.NodeMindmap, ast.NodeMindmapItem} {
		t.Run(typ.String(), func(t *testing.T) {
			root, outer, inner := newNode(ast.NodeDocument), newNode(typ), newNode(ast.NodeListItem)
			first, second := newNode(ast.NodeParagraph), newNode(ast.NodeParagraph)
			root.AppendChild(outer)
			parent := outer
			if typ == ast.NodeTabs {
				parent = newNode(ast.NodeTabItem)
				outer.AppendChild(parent)
			} else if typ == ast.NodeMindmap {
				parent = newNode(ast.NodeMindmapItem)
				outer.AppendChild(parent)
			} else if typ == ast.NodeTabItem || typ == ast.NodeMindmapItem {
				wrapperType := ast.NodeTabs
				if typ == ast.NodeMindmapItem {
					wrapperType = ast.NodeMindmap
				}
				wrapper := newNode(wrapperType)
				outer.Unlink()
				root.AppendChild(wrapper)
				wrapper.AppendChild(outer)
			}
			if typ != ast.NodeList {
				list := newNode(ast.NodeList)
				parent.AppendChild(list)
				parent = list
			}
			parent.AppendChild(inner)
			inner.AppendChild(first)
			inner.AppendChild(second)
			tag(first, "todo")
			tag(second, "todo")
			tree := &parse.Tree{ID: root.ID, Root: root, Box: "box", Path: "/" + root.ID + ".sy"}
			source := &av.AutomationBlockSource{DocumentIDs: []string{root.ID}, Tags: []string{"todo"}}
			matches := collectionMatches(source, tree)
			if len(matches) != 2 || !matches[inner.ID] || !matches[second.ID] {
				t.Fatalf("default list-item behavior changed: %v", matches)
			}
			source.TagTarget = "block"
			matches = collectionMatches(source, tree)
			if len(matches) != 2 || !matches[first.ID] || !matches[second.ID] {
				t.Fatalf("direct tag blocks: %v", matches)
			}
			source.TagTarget = "container"
			matches = collectionMatches(source, tree)
			if len(matches) != 1 || !matches[inner.ID] {
				t.Fatalf("nearest container and duplicate sources: %v", matches)
			}
			outer.SetIALAttr("custom-state", "ready")
			source.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "ready"}}
			matches = collectionMatches(source, tree)
			if len(matches) != 1 || !matches[outer.ID] {
				t.Fatalf("attributes must select the target container: %v", matches)
			}
			source.Tags = []string{"todo", "other"}
			tag(second, "other")
			matches = collectionMatches(source, tree)
			if len(matches) != 1 || !matches[outer.ID] {
				t.Fatal("one source containing all tags did not match")
			}
			second.FirstChild.Unlink()
			if len(collectionMatches(source, tree)) != 0 {
				t.Fatal("AND tags were combined across different source blocks")
			}
			source.TagMatch = "or"
			if !collectionMatches(source, tree)[outer.ID] {
				t.Fatal("OR tags did not match independently")
			}
			source.DocumentIDs = []string{"outside"}
			if len(collectionMatches(source, tree)) != 0 {
				t.Fatal("container matching escaped its document scope")
			}
		})
	}
}

func TestBlockCollectionTagTargetUndoAndPreservation(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	rule := view.Automations.Rules[0]
	view.Automations.Spec = 4
	rule.BlockSource.TagTarget = "container"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	row := view.GetBlockValueByBoundID(fixture.sourceID)
	if row == nil {
		t.Fatal("explicit document container did not collect")
	}
	itemID := row.BlockID
	view.GetValue(keyID, itemID).Text.Content = "Edited"
	rule = view.Automations.Rules[0]
	rule.BlockSource.TagTarget = "block"
	if err := PerformAttributeViewOperations([]*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: view.Automations}}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(itemID) == nil {
		t.Fatal("changing target removed an existing entry")
	}
	view.GetValue(keyID, itemID).Text.Content = "Edited"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	remove := blockCollectionTags(t, fixture.sourceID, "")
	if err := PerformTxSync(remove); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) == nil {
		t.Fatal("lost tag removed the existing entry")
	}
	undo := &Transaction{DoOperations: cloneOperations(remove.UndoOperations), UndoOperations: cloneOperations(remove.DoOperations), isReplay: true}
	if err := PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(itemID) == nil || view.GetValue(keyID, itemID).Text.Content != "Edited" {
		t.Fatal("undo lost the original entry or its edited fields")
	}
}

func TestBlockCollectionTagTargetTypesAndDocuments(t *testing.T) {
	root := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeDocument}
	list := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeList, ListData: &ast.ListData{Typ: 1}}
	item := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeListItem, ListData: &ast.ListData{Typ: 1}}
	paragraph := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	tag := &ast.Node{Type: ast.NodeTag}
	tag.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("todo")})
	paragraph.AppendChild(tag)
	root.AppendChild(list)
	list.AppendChild(item)
	item.AppendChild(paragraph)
	tree := &parse.Tree{ID: root.ID, Root: root, Box: "box", Path: "/" + root.ID + ".sy"}
	source := &av.AutomationBlockSource{NotebookIDs: []string{"box"}, Tags: []string{"todo"}, TagTarget: "container"}
	for _, test := range []struct {
		types []string
		want  string
	}{
		{[]string{"p", "i:o", "l:o", "d"}, item.ID},
		{[]string{"l:o"}, list.ID},
		{[]string{"l:t"}, ""},
		{[]string{"p"}, ""},
		{[]string{"d"}, root.ID},
	} {
		source.Types = test.types
		matches := collectionMatches(source, tree)
		if test.want == "" && len(matches) != 0 || test.want != "" && (len(matches) != 1 || !matches[test.want]) {
			t.Fatalf("types %v: %v want %s", test.types, matches, test.want)
		}
	}
	source.Types = nil
	list.Unlink()
	root.AppendChild(paragraph)
	if len(collectionMatches(source, tree)) != 0 {
		t.Fatal("unrestricted containers unexpectedly collected the document")
	}
	source.Tags, source.Types = nil, []string{"p"}
	if !collectionMatches(source, tree)[paragraph.ID] {
		t.Fatal("tag target changed a rule without tag conditions")
	}
}
