//go:build fts5

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupBlockCollectionTest(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, string) {
	t.Helper()
	oldQueueDir := util.QueueDir
	util.QueueDir = t.TempDir()
	t.Cleanup(func() { util.QueueDir = oldQueueDir })
	fixture, _, _, _ := setupAttributeViewItemsTest(t, false)
	view := av.NewAttributeView(ast.NewNodeID())
	keyID := ast.NewNodeID()
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Status", Type: av.KeyTypeText}})
	view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{
		ID: ast.NewNodeID(), Name: "Collect", Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{fixture.sourceID}, Types: []string{"d"}, Tags: []string{"todo"}},
		Actions: []*av.AutomationAction{{Type: "collect", Target: "current", Fields: map[string]*av.AutomationValue{
			keyID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "New"}}},
		}}},
	}}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	return fixture, view, keyID
}

func blockCollectionTags(t *testing.T, id, tags string) *Transaction {
	t.Helper()
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(map[string]string{"tags": tags})
	undo, _ := json.Marshal(map[string]string{"tags": tree.Root.IALAttr("tags")})
	return &Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "setAttrs", ID: id, Data: string(data)}},
		UndoOperations: []*Operation{{Action: "setAttrs", ID: id, Data: string(undo)}},
	}
}

func TestBlockCollectionTransitionsAndUndo(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	row := view.GetBlockValueByBoundID(fixture.sourceID)
	if row == nil || row.Block.CollectionRuleID != view.Automations.Rules[0].ID || view.GetValue(keyID, row.BlockID).Text.Content != "New" {
		t.Fatalf("missing collected row or initialization: %+v", row)
	}
	itemID := row.BlockID
	view.GetValue(keyID, itemID).Text.Content = "Edited"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo,other")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if len(view.GetBlockKeyValues().Values) != 1 || view.GetValue(keyID, itemID).Text.Content != "Edited" {
		t.Fatal("repeated match reset or duplicated row")
	}
	remove := blockCollectionTags(t, fixture.sourceID, "")
	if err := PerformTxSync(remove); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) == nil {
		t.Fatal("source mismatch removed an existing entry")
	}
	if _, err := LoadTreeByBlockID(fixture.sourceID); err != nil {
		t.Fatal("collection deleted the original block", err)
	}
	undo := &Transaction{DoOperations: cloneOperations(remove.UndoOperations), UndoOperations: cloneOperations(remove.DoOperations), isReplay: true}
	if err := PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(itemID) == nil || view.GetValue(keyID, itemID).Text.Content != "Edited" {
		t.Fatal("undo did not restore exact fields")
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(undo.UndoOperations), UndoOperations: cloneOperations(undo.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	row = view.GetBlockValueByBoundID(fixture.sourceID)
	if row == nil || row.BlockID != itemID || view.GetValue(keyID, row.BlockID).Text.Content != "Edited" {
		t.Fatal("re-adding tag reset or replaced the preserved entry")
	}
}

func TestBlockCollectionSynchronizesFinalBindingAttrs(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	tx := blockCollectionTags(t, fixture.sourceID, "todo")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	last := tx.DoOperations[len(tx.DoOperations)-1]
	if last.Action != "updateAttrs" || last.ID != fixture.sourceID || !last.IsAutomaticAttributeViewOperation() {
		t.Fatalf("final binding attributes must follow the source and database operations: %+v", last)
	}
	data := last.Data.(map[string]any)
	attrs := data["new"].(map[string]string)
	if attrs[av.NodeAttrNameAvs] != view.ID || attrs[av.NodeAttrViewNames] == "" {
		t.Fatalf("missing binding or badge in the transaction: %v", attrs)
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	if tree.Root.IALAttr(av.NodeAttrNameAvs) != attrs[av.NodeAttrNameAvs] {
		t.Fatal("broadcast binding differs from the persisted source")
	}
	for _, operations := range [][]*Operation{cloneOperations(tx.UndoOperations), cloneOperations(tx.DoOperations)} {
		replay := &Transaction{DoOperations: operations, isReplay: true}
		if err = PerformTxSync(replay); err != nil {
			t.Fatal(err)
		}
		last = replay.DoOperations[len(replay.DoOperations)-1]
		if last.Action != "updateAttrs" || last.ID != fixture.sourceID {
			t.Fatalf("replay did not finish with the current binding attributes: %+v", last)
		}
		tree, err = LoadTreeByBlockID(fixture.sourceID)
		if err != nil {
			t.Fatal(err)
		}
		attrs = last.Data.(map[string]any)["new"].(map[string]string)
		if attrs[av.NodeAttrNameAvs] != tree.Root.IALAttr(av.NodeAttrNameAvs) {
			t.Fatal("replay sent a stale binding")
		}
	}
}

func TestBlockCollectionPreservesBindingDuringQueuedEdits(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	view.Automations.Rules[0].BlockSource.Types = []string{"p"}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{`<span data-type="tag">todo</span>`, `More <span data-type="tag">todo</span> text`} {
		// 连续输入的正文快照可能早于上一笔自动绑定的属性通知。
		dom := fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, fixture.childID, content)
		tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom}}}
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		tree, err := LoadTreeByBlockID(fixture.childID)
		if err != nil {
			t.Fatal(err)
		}
		if treenode.GetNodeInTree(tree, fixture.childID).IALAttr(av.NodeAttrNameAvs) != view.ID {
			t.Fatal("queued source edit discarded the existing database binding")
		}
		view = readAttributeViewItemsTest(t, view.ID)
		if len(view.GetBlockKeyValues().Values) != 1 || view.GetBlockValueByBoundID(fixture.childID) == nil {
			t.Fatal("queued source edit duplicated or removed the collected row")
		}
	}
}

func TestBlockCollectionMultipleRulesAndManualRows(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	first := view.Automations.Rules[0]
	second := &av.AutomationRule{ID: ast.NewNodeID(), Name: "Other", Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{fixture.sourceID}, Types: []string{"d"}, Tags: []string{"other"}}, Actions: first.Actions}
	view.Automations.Rules = append(view.Automations.Rules, second)
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, tags := range []string{"todo,other", "other"} {
		if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, tags)); err != nil {
			t.Fatal(err)
		}
		if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 1 {
			t.Fatal("a remaining rule lost its row")
		}
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "")); err != nil {
		t.Fatal(err)
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 1 {
		t.Fatal("last matching rule's mismatch removed an existing entry")
	}
	stored := readAttributeViewItemsTest(t, view.ID)
	if err := PerformAttributeViewOperations([]*Operation{{Action: "removeAttrViewBlock", AvID: view.ID,
		SrcIDs: []string{stored.GetBlockValueByBoundID(fixture.sourceID).BlockID}}}); err != nil {
		t.Fatal(err)
	}
	if err := PerformAttributeViewOperations([]*Operation{{Action: "insertAttrViewBlock", AvID: view.ID,
		Srcs: []map[string]any{{"id": fixture.sourceID, "isDetached": false}}}}); err != nil {
		t.Fatal(err)
	}
	for _, tags := range []string{"todo", ""} {
		if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, tags)); err != nil {
			t.Fatal(err)
		}
	}
	row := readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.sourceID)
	if row == nil || row.Block.CollectionRuleID != "" {
		t.Fatal("manual row was taken over or removed")
	}
}

func TestBlockCollectionFailureRollsBackSource(t *testing.T) {
	for _, failure := range []string{"corruption", "commit"} {
		t.Run(failure, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			if failure == "corruption" {
				if err := os.WriteFile(filepath.Join(util.DataDir, "storage", "av", view.ID+".json"), []byte("corrupt"), 0600); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
			}
			tx := blockCollectionTags(t, fixture.sourceID, "todo")
			if failure == "commit" {
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected write failure") }
			}
			if err := PerformTxSync(tx); err == nil {
				t.Fatal("collection failure was swallowed")
			}
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil || tree.Root.IALAttr("tags") != "" {
				t.Fatal("failed transaction saved original edit", err)
			}
			if failure == "commit" && len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
				t.Fatal("failed transaction left a collected row")
			}
		})
	}
}

func TestBlockCollectionPreviewAndExplicitCollection(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	view.Automations.Rules[0].Enabled = false
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view.Automations.Rules[0].Enabled = true
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewAttributeViewCollection(view.ID, view.Automations.Rules[0].ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Blocks) != 1 || preview.Blocks[0].Collected || preview.Blocks[0].ID != fixture.sourceID {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("preview collected existing content")
	}
	op := &Operation{Action: "collectAttrViewBlocks", AvID: view.ID, Data: map[string]any{"ruleID": view.Automations.Rules[0].ID, "blockIDs": []string{fixture.sourceID}}}
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{op}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.sourceID) == nil {
		t.Fatal("explicit collection did not bind the source")
	}
}

func TestBlockCollectionFailedCreationLeavesNoDocument(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	rule := view.Automations.Rules[0]
	rule.BlockSource.DocumentIDs, rule.BlockSource.NotebookIDs = nil, []string{fixture.box.ID}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	id := ast.NewNodeID()
	tree := treenode.NewTree(fixture.box.ID, "/"+id+".sy", "/New source", "New source")
	tree.Root.SetIALAttr("tags", "todo")
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "create", Tree: tree}}}
	written := false
	tx.writeTransactionTree = func(created *parse.Tree) error {
		if _, err := filesys.WriteTree(created); err != nil {
			return err
		}
		written = true
		return errors.New("injected failure after document write")
	}
	if err := PerformTxSync(tx); err == nil || !written {
		t.Fatal("creation did not reach injected commit failure", err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, tree.Box, tree.Path)); !os.IsNotExist(err) {
		t.Fatal("failed collection left its new document", err)
	}
	if treenode.GetBlockTree(id) != nil || readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(id) != nil {
		t.Fatal("failed creation left a block index or collected row")
	}
}

func TestBlockCollectionInlineTagsAndAttributes(t *testing.T) {
	rootID, listID, paragraphID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	root := &ast.Node{ID: rootID, Type: ast.NodeDocument}
	list := &ast.Node{ID: listID, Type: ast.NodeListItem}
	paragraph := &ast.Node{ID: paragraphID, Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
	list.AppendChild(paragraph)
	root.AppendChild(list)
	tree := &parse.Tree{ID: rootID, Root: root, Box: "notebook", Path: "/parent/" + rootID + ".sy"}
	source := &av.AutomationBlockSource{DocumentIDs: []string{"parent"}, Tags: []string{"todo"}}
	if !collectionMatches(source, tree)[list.ID] || collectionMatches(source, tree)[root.ID] || collectionMatches(source, tree)[paragraph.ID] {
		t.Fatal("inline tags must not collect ancestor containers or duplicate a list item's first paragraph")
	}
	source.Types = []string{"p"}
	if !collectionMatches(source, tree)[paragraph.ID] || collectionMatches(source, tree)[list.ID] {
		t.Fatal("explicit paragraph selection was not respected")
	}
	source.Types = []string{"p", "i"}
	matches := collectionMatches(source, tree)
	if len(matches) != 1 || !matches[list.ID] {
		t.Fatalf("default selection duplicated a list item and its first paragraph: %v", matches)
	}
	source.Types = []string{"p"}
	paragraph.SetIALAttr("custom-state", "A&B")
	source.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "A&B"}}
	source.Types = []string{"p", "i"}
	if matches = collectionMatches(source, tree); len(matches) != 1 || !matches[paragraph.ID] {
		t.Fatal("default selection did not filter the final object's attributes")
	}
	list.SetIALAttr("custom-state", "A&B")
	if matches = collectionMatches(source, tree); len(matches) != 1 || !matches[list.ID] {
		t.Fatal("eligible list item must take precedence over its first paragraph")
	}
	source.Types = []string{"p"}
	if !collectionMatches(source, tree)[paragraph.ID] {
		t.Fatal("custom attribute matching used escaped storage text")
	}
	source.Attributes[0].Operator = "notExists"
	if collectionMatches(source, tree)[paragraph.ID] {
		t.Fatal("existing attribute matched absence condition")
	}
}

func TestBlockCollectionSubtypes(t *testing.T) {
	rootID := ast.NewNodeID()
	tree := &parse.Tree{ID: rootID, Box: "notebook", Path: "/" + rootID + ".sy"}
	for _, test := range []struct {
		typ             ast.NodeType
		sub             string
		listType, level int
	}{
		{ast.NodeList, "u", 0, 0}, {ast.NodeList, "o", 1, 0}, {ast.NodeList, "t", 3, 0},
		{ast.NodeListItem, "u", 0, 0}, {ast.NodeListItem, "o", 1, 0}, {ast.NodeListItem, "t", 3, 0},
		{ast.NodeHeading, "h1", 0, 1}, {ast.NodeHeading, "h2", 0, 2}, {ast.NodeHeading, "h6", 0, 6},
		{ast.NodeCallout, "WARNING", 0, 0}, {ast.NodeCallout, "NOTE", 0, 0}, {ast.NodeCallout, "CUSTOM", 0, 0},
		{ast.NodeParagraph, "", 0, 0},
	} {
		node := &ast.Node{ID: ast.NewNodeID(), Type: test.typ, HeadingLevel: test.level,
			ListData: &ast.ListData{Typ: test.listType}, CalloutType: test.sub}
		tree.Root = node
		main := treenode.TypeAbbr(node.Type.String())
		for _, types := range [][]string{nil, {main}, {"l:u"}, {"i:t"}, {"h:h1", "h:h2"}, {"callout:WARNING"}, {"callout:CUSTOM"}} {
			source := &av.AutomationBlockSource{DocumentIDs: []string{rootID}, Types: types}
			want := len(types) == 0
			for _, typ := range types {
				want = want || typ == main || test.sub != "" && typ == main+":"+test.sub
			}
			if got := collectionMatches(source, tree)[node.ID]; got != want {
				t.Fatalf("%s:%s with %v: %v want %v", main, test.sub, types, got, want)
			}
		}
	}
}

func TestBlockCollectionConditionCombinations(t *testing.T) {
	id := ast.NewNodeID()
	node := &ast.Node{ID: id, Type: ast.NodeDocument}
	node.SetIALAttr("tags", "todo")
	node.SetIALAttr("custom-state", "ready")
	tree := &parse.Tree{ID: id, Box: "notebook", Path: "/" + id + ".sy", Root: node}
	source := &av.AutomationBlockSource{DocumentIDs: []string{id}, Tags: []string{"todo", "other"},
		Attributes: []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "ready"},
			{Name: "custom-flag", Operator: "exists"}}}
	for _, modes := range []struct {
		tags, attrs string
		want        bool
	}{
		{"", "", false}, {"and", "and", false}, {"or", "and", false}, {"and", "or", false}, {"or", "or", true},
	} {
		source.TagMatch, source.AttributeMatch = modes.tags, modes.attrs
		if got := collectionMatches(source, tree)[node.ID]; got != modes.want {
			t.Fatalf("%+v: %v", modes, got)
		}
	}
	source.Tags = []string{"missing"}
	if collectionMatches(source, tree)[node.ID] {
		t.Fatal("OR inside a group bypassed the other group")
	}
	source.Tags, source.Attributes = nil, nil
	if !collectionMatches(source, tree)[node.ID] {
		t.Fatal("empty OR groups restricted matches")
	}
	source.Types = []string{"p"}
	if collectionMatches(source, tree)[node.ID] {
		t.Fatal("empty groups bypassed type filtering")
	}
}

func TestBlockCollectionAnyTagTransitions(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	rule := view.Automations.Rules[0]
	view.Automations.Spec = 3
	rule.BlockSource.Tags, rule.BlockSource.TagMatch = []string{"todo", "other"}, "or"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	var itemID string
	for _, tags := range []string{"other", "todo", "none"} {
		if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, tags)); err != nil {
			t.Fatal(err)
		}
		stored := readAttributeViewItemsTest(t, view.ID)
		row := stored.GetBlockValueByBoundID(fixture.sourceID)
		preview, err := PreviewAttributeViewCollection(view.ID, rule.ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		if tags == "none" {
			if row == nil || row.BlockID != itemID || len(preview.Blocks) != 0 {
				t.Fatal("OR mismatch removed a preserved row or remained in matching preview")
			}
		} else {
			if row == nil || len(preview.Blocks) != 1 {
				t.Fatal("OR match not reflected in collection and preview")
			}
			if itemID != "" && row.BlockID != itemID {
				t.Fatal("switching between matching tags recreated the row")
			}
			itemID = row.BlockID
		}
	}
}

func TestBlockCollectionCreateAndMoveAcrossScope(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	rule := view.Automations.Rules[0]
	rule.BlockSource.Tags = nil
	rule.BlockSource.Types = []string{"p"}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	// 已有段落不会因启用规则被补收，移入监听文档才产生匹配变化。
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.NewParagraph("")
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Moved source")})
	target.Root.AppendChild(node)
	if _, err = filesys.WriteTree(target); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(target)
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: node.ID, ParentID: fixture.sourceID}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(node.ID) == nil {
		t.Fatal("move into scope did not collect")
	}
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: node.ID, ParentID: fixture.targetID}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(node.ID) == nil {
		t.Fatal("move out of scope removed the preserved entry")
	}
	rule.BlockSource.DocumentIDs, rule.BlockSource.NotebookIDs = nil, []string{fixture.box.ID}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	created, err := CreateDocByMdSync(fixture.box.ID, "/"+ast.NewNodeID()+".sy", "New document", "New source", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(created.Root.FirstChild.ID) == nil {
		t.Fatal("new document content did not trigger collection")
	}
}
