// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func collectionTestReference(id string, pure bool) *ast.Node {
	paragraph := treenode.NewParagraph("")
	if !pure {
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Source ")})
	}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: id,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Target"})
	return paragraph
}

func TestBlockCollectionReferenceTargetsAndSources(t *testing.T) {
	fixture, _, _ := setupBlockCollectionTest(t)
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	var childID string
	for id, node := range collectionNodes(target) {
		if node.Type == ast.NodeParagraph {
			childID = id
			break
		}
	}
	if childID == "" {
		t.Fatal("target has no content block")
	}
	childDocument, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(target.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Child document", "Content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	root := &ast.Node{ID: fixture.sourceID, Type: ast.NodeDocument}
	direct, content, subdocument := collectionTestReference(target.ID, false), collectionTestReference(childID, false), collectionTestReference(childDocument.ID, false)
	root.AppendChild(direct)
	root.AppendChild(content)
	root.AppendChild(subdocument)
	// 同一来源中的重复引用仍只收集一次，静态锚文本与动态锚文本使用相同的目标 ID。
	direct.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: target.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Renamed"})
	embed := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockQueryEmbed}
	embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + target.ID + "'")})
	root.AppendChild(embed)
	link := treenode.NewParagraph("")
	link.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "siyuan://blocks/" + target.ID, TextMarkTextContent: "Link"})
	root.AppendChild(link)
	database := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeAttributeView, AttributeViewID: ast.NewNodeID()}
	root.AppendChild(database)
	tree := &parse.Tree{ID: root.ID, Root: root, Box: fixture.box.ID, Path: "/" + root.ID + ".sy"}
	source := &av.AutomationBlockSource{DocumentIDs: []string{root.ID}, ReferenceID: target.ID}
	matches := collectionMatches(source, tree)
	if len(matches) != 2 || !matches[direct.ID] || !matches[content.ID] {
		t.Fatalf("document references must include internal blocks only: %v", matches)
	}
	source.ReferenceID = childID
	if matches = collectionMatches(source, tree); len(matches) != 1 || !matches[content.ID] {
		t.Fatalf("a non-document target must match its own ID: %v", matches)
	}
	source.Tags = []string{"todo"}
	direct.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
	if matches = collectionMatches(source, tree); len(matches) != 0 {
		t.Fatal("tag and reference matched across different sources")
	}
	content.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
	if matches = collectionMatches(source, tree); len(matches) != 1 || !matches[content.ID] {
		t.Fatal("tag and reference did not match on the same source")
	}
	source.DocumentIDs = []string{target.ID}
	if len(collectionMatches(source, tree)) != 0 {
		t.Fatal("reference matching escaped the source scope")
	}
}

func TestBlockCollectionReferenceBacklinkGrouping(t *testing.T) {
	fixture, _, _ := setupBlockCollectionTest(t)
	for _, typ := range []ast.NodeType{ast.NodeDocument, ast.NodeHeading, ast.NodeListItem, ast.NodeBlockquote, ast.NodeSuperBlock, ast.NodeCallout} {
		t.Run(typ.String(), func(t *testing.T) {
			root := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeDocument}
			parent := &ast.Node{ID: ast.NewNodeID(), Type: typ, HeadingLevel: 1}
			first, second := collectionTestReference(fixture.targetID, true), collectionTestReference(fixture.targetID, false)
			switch typ {
			case ast.NodeDocument:
				parent = root
				root.AppendChild(first)
				root.AppendChild(second)
			case ast.NodeHeading:
				introduction := treenode.NewParagraph("")
				introduction.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Introduction")})
				root.AppendChild(introduction)
				root.AppendChild(parent)
				root.AppendChild(first)
				root.AppendChild(second)
			case ast.NodeListItem:
				list := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeList, ListData: &ast.ListData{Typ: 0}}
				parent.ListData = &ast.ListData{Typ: 0}
				root.AppendChild(list)
				list.AppendChild(parent)
				parent.AppendChild(first)
				parent.AppendChild(second)
			default:
				root.AppendChild(parent)
				other := treenode.NewParagraph("")
				other.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Other content")})
				parent.AppendChild(other)
				parent.AppendChild(first)
				parent.AppendChild(second)
			}
			tree := &parse.Tree{ID: root.ID, Root: root, Box: fixture.box.ID, Path: "/" + root.ID + ".sy"}
			source := &av.AutomationBlockSource{DocumentIDs: []string{root.ID}, ReferenceID: fixture.targetID, TagTarget: "block"}
			matches := collectionMatches(source, tree)
			if len(matches) != 1 || !matches[parent.ID] {
				t.Fatalf("backlink parent was not selected exclusively: %v", matches)
			}
			parent.SetIALAttr("custom-state", "ready")
			source.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "ready"}}
			if !collectionMatches(source, tree)[parent.ID] {
				t.Fatal("attributes did not constrain the final parent")
			}
			source.Types = []string{"p"}
			if len(collectionMatches(source, tree)) != 0 {
				t.Fatal("type filtering fell back from the backlink parent to a child")
			}
			source.Types, source.Attributes = nil, nil
			if typ == ast.NodeDocument || typ == ast.NodeHeading {
				first.PrependChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Text ")})
				matches = collectionMatches(source, tree)
				if len(matches) != 2 || !matches[first.ID] || !matches[second.ID] {
					t.Fatal("a mixed-text first paragraph propagated to its document or heading")
				}
			}
		})
	}
}

func TestBlockCollectionReferenceTransactionsAndReview(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	view.Automations.Spec = 8
	rule := view.Automations.Rules[0]
	rule.BlockSource = &av.AutomationBlockSource{DocumentIDs: []string{fixture.sourceID}, ReferenceID: fixture.targetID}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	dom := func(content string) string {
		return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, fixture.childID, content)
	}
	reference := fmt.Sprintf(`Source <span data-type="block-ref" data-id="%s" data-subtype="d">Target</span>`, fixture.targetID)
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom(reference)}},
		UndoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("Source")}}}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	row := view.GetBlockValueByBoundID(fixture.childID)
	if row == nil || view.GetValue(keyID, row.BlockID).Text.Content != "New" {
		t.Fatal("new reference did not bind the original block and initialize its fields")
	}
	for _, operations := range [][]*Operation{cloneOperations(tx.UndoOperations), cloneOperations(tx.DoOperations)} {
		if err := PerformTxSync(&Transaction{DoOperations: operations, isReplay: true}); err != nil {
			t.Fatal(err)
		}
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(fixture.childID).BlockID != row.BlockID {
		t.Fatal("redo did not restore the original item ID")
	}
	view.GetValue(keyID, row.BlockID).Text.Content = "Edited"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("Removed")}}}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(row.BlockID) == nil || view.GetValue(keyID, row.BlockID).Text.Content != "Edited" {
		t.Fatal("removing the reference discarded the item or fields")
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Unmatched != 1 {
		t.Fatalf("review did not detect the removed reference: %+v %v", review, err)
	}
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom(reference)}}}); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewAttributeViewCollection(view.ID, rule.ID, 1)
	if err != nil || len(preview.Blocks) != 1 || preview.Blocks[0].ID != fixture.childID || !preview.Blocks[0].Collected {
		t.Fatalf("preview disagreed with real-time collection: %+v %v", preview, err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if len(view.GetBlockKeyValues().Values) != 1 || view.GetValue(keyID, row.BlockID).Text.Content != "Edited" {
		t.Fatal("matching again duplicated the item or reset edited fields")
	}
	// 删除引用目标后，来源仍可编辑，失效规则停用并保留已收集的数据。
	treenode.RemoveBlockTreesByRootID(fixture.box.ID, fixture.targetID)
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("Still editable")}}}); err != nil {
		t.Fatal("missing target blocked source editing", err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.Automations.Rules[0].Enabled || view.GetValue(keyID, row.BlockID).Text.Content != "Edited" {
		t.Fatal("missing target did not pause safely while preserving fields")
	}
}
