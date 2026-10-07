//go:build fts5

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type relationItemTestFixture struct {
	files                                                     *fileOperationTestFixture
	source, target                                            *av.AttributeView
	sourceBlockID, targetBlockID, keyID, backKeyID, textKeyID string
	itemIDs                                                   []string
}

func setupRelationItemTest(t *testing.T, itemTemplate *av.NewItemTemplate) *relationItemTestFixture {
	t.Helper()
	files := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, files, ast.NewNodeID())
	source, target := database.attrView, av.NewAttributeView(ast.NewNodeID())
	keyID, backKeyID, textKeyID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Related", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: backKeyID}}})
	target.KeyValues = append(target.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: backKeyID, Name: "Back", Type: av.KeyTypeRelation,
			Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: keyID}}},
		&av.KeyValues{Key: av.NewKey(textKeyID, "Default text", "", av.KeyTypeText)})
	itemIDs := []string{source.GetBlockKeyValues().Values[0].BlockID, ast.NewNodeID()}
	source.GetBlockKeyValues().Values = append(source.GetBlockKeyValues().Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: source.GetBlockKey().ID, BlockID: itemIDs[1], Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "Second source"}})
	for _, view := range source.Views {
		view.ItemIDs = append(view.ItemIDs, itemIDs[1])
	}
	if itemTemplate != nil {
		itemTemplate.ID = ast.NewNodeID()
		itemTemplate.Name = "Default"
		itemTemplate.FieldValues = map[string]*av.NewItemFieldValue{
			textKeyID: {Mode: av.NewItemFieldValueStatic, Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Preset"}}},
			backKeyID: {Mode: av.NewItemFieldValueStatic, Value: &av.Value{Type: av.KeyTypeRelation,
				Relation: &av.ValueRelation{BlockIDs: []string{itemIDs[0]}}}},
		}
		if err := target.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{itemTemplate}, DefaultTemplateID: itemTemplate.ID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, view := range []*av.AttributeView{source, target} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	tree, err := LoadTreeByBlockID(files.targetID)
	if err != nil {
		t.Fatal(err)
	}
	for tree.Root.FirstChild != nil {
		tree.Root.FirstChild.Unlink()
	}
	node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: target.ID,
		AttributeViewType: "table"}
	node.SetIALAttr("id", node.ID)
	node.SetIALAttr(av.NodeAttrView, target.Views[0].ID)
	tree.Root.AppendChild(node)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	av.BatchUpsertBlockRel([]*ast.Node{node})
	return &relationItemTestFixture{files: files, source: source, target: target,
		sourceBlockID: database.nodes[0].ID, targetBlockID: node.ID, keyID: keyID,
		backKeyID: backKeyID, textKeyID: textKeyID, itemIDs: itemIDs}
}

func TestAttributeViewRelationItemCreation(t *testing.T) {
	for _, test := range []struct {
		name, primary, keyword, want string
		target                       av.NewItemTargetType
		useInputName                 bool
	}{
		{"without template", "", "Task A", "Task A", "", false},
		{"fallback", "", "Task A", "Task A", av.NewItemTargetDetached, false},
		{"primary takes precedence", "Task from template", "Task A", "Task from template", av.NewItemTargetDetached, false},
		{"empty search", "Task from template", "", "Task from template", av.NewItemTargetDetached, false},
		{"blank item", "", "", "", "", false},
		{"document", "Task document", "Task A", "Task document", av.NewItemTargetDocument, false},
		{"input name", "Task from template", "  Task A  ", "Task A", av.NewItemTargetDetached, true},
		{"document input name", "Task document", "Task A", "Task A", av.NewItemTargetDocument, true},
		{"normalized document input", "Task document", "Task /A", "Task A", av.NewItemTargetDocument, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var template *av.NewItemTemplate
			if test.target != "" {
				template = &av.NewItemTemplate{TargetType: test.target, PrimaryKeyTemplate: test.primary, Icon: "1f600"}
			}
			if test.target == av.NewItemTargetDocument && test.useInputName {
				template.SaveLocation = &av.NewItemSaveLocation{PathTemplate: "/Relation items/"}
				template.ContentTemplatePath = "/relation.md"
			}
			fixture := setupRelationItemTest(t, template)
			if template != nil && template.ContentTemplatePath != "" {
				templateDir := filepath.Join(util.DataDir, "templates")
				if err := os.MkdirAll(templateDir, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(templateDir, "relation.md"), []byte("Template body"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			preview := PreviewAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, test.keyword)
			wantPreview := test.want
			if test.useInputName {
				wantPreview = test.primary
			}
			if preview.Error != "" || preview.PrimaryKey != wantPreview || preview.HasPrimaryKeyTemplate != (test.primary != "") {
				t.Fatalf("unexpected preview: %+v", preview)
			}
			wantInput := strings.TrimSpace(test.keyword)
			if test.target == av.NewItemTargetDocument {
				wantInput = normalizeDocTitle(wantInput)
			}
			if preview.InputPrimaryKey != wantInput {
				t.Fatalf("input preview: got %q, want %q", preview.InputPrimaryKey, wantInput)
			}
			cells := []*AttributeViewRelationItemCell{{ItemID: fixture.itemIDs[0]}, {ItemID: fixture.itemIDs[1]}}
			created, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, test.keyword, cells, preview, test.useInputName)
			if err != nil || created.Content != test.want || created.IsDetached != (test.target != av.NewItemTargetDocument) {
				t.Fatalf("creation: %+v, %v", created, err)
			}
			assertCreated := func() {
				target := readAttributeViewItemsTest(t, fixture.target.ID)
				value := target.GetBlockValue(created.ItemID)
				if value == nil || value.Block.Content != test.want {
					t.Fatalf("missing created item: %+v", value)
				}
				if template != nil {
					if value.Block.Icon != "1f600" || target.GetValue(fixture.textKeyID, created.ItemID).Text.Content != "Preset" {
						t.Fatal("default template fields or icon were lost")
					}
				}
				source := readAttributeViewItemsTest(t, fixture.source.ID)
				for _, id := range fixture.itemIDs {
					assertContextFilterRelationIDs(t, source.GetValue(fixture.keyID, id), created.ItemID)
				}
				assertContextFilterRelationIDs(t, target.GetValue(fixture.backKeyID, created.ItemID), fixture.itemIDs...)
				if template != nil && template.ContentTemplatePath != "" {
					tree, err := LoadTreeByBlockID(created.BlockID)
					if err != nil {
						t.Fatal(err)
					}
					found := false
					ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
						if entering && node.Type == ast.NodeText && string(node.Tokens) == "Template body" {
							found = true
						}
						return ast.WalkContinue
					})
					if !found {
						t.Fatal("input name override lost the content template")
					}
				}
			}
			assertCreated()
			entry := GlobalUndoLog.Peek(fixture.files.sourceID)
			if entry == nil || len(entry.UndoOperationsForReplay()) == 0 {
				t.Fatal("relation creation is missing from the source document undo log")
			}
			if !created.IsDetached {
				block := treenode.GetBlockTree(created.BlockID)
				parent := "/Target/"
				if test.useInputName {
					parent = "/Relation items/"
				}
				if block == nil || block.HPath != parent+test.want {
					t.Fatalf("document did not use the target database location: %+v", block)
				}
			}
			if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
				t.Fatal(err)
			}
			if readAttributeViewItemsTest(t, fixture.target.ID).GetBlockValue(created.ItemID) != nil {
				t.Fatal("undo retained created item")
			}
			for _, id := range fixture.itemIDs {
				value := readAttributeViewItemsTest(t, fixture.source.ID).GetValue(fixture.keyID, id)
				if value != nil && value.Relation != nil && len(value.Relation.BlockIDs) != 0 {
					t.Fatal("undo retained relation")
				}
			}
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(created.Transaction.DoOperations), isReplay: true}); err != nil {
				t.Fatal(err)
			}
			assertCreated()
		})
	}
}

func TestAttributeViewRelationItemPreviewValidation(t *testing.T) {
	fixture := setupRelationItemTest(t, &av.NewItemTemplate{TargetType: av.NewItemTargetDetached,
		PrimaryKeyTemplate: `Task {{now | date "150405.000"}}`})
	preview := PreviewAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Search")
	preview.CreatedAt -= 1200
	preview.PrimaryKey = "Task " + time.UnixMilli(preview.CreatedAt).Format("150405.000")
	cells := []*AttributeViewRelationItemCell{{ItemID: fixture.itemIDs[0]}}
	before, _ := json.Marshal(fixture.target)
	if _, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "  ", cells, preview, true); err == nil {
		t.Fatal("empty input name accepted")
	}
	for _, test := range []struct {
		name   string
		change func(*AttributeViewRelationItemPreview)
	}{
		{"expired", func(p *AttributeViewRelationItemPreview) { p.CreatedAt -= int64((6 * time.Minute) / time.Millisecond) }},
		{"future", func(p *AttributeViewRelationItemPreview) { p.CreatedAt += int64(time.Minute / time.Millisecond) }},
		{"changed name", func(p *AttributeViewRelationItemPreview) { p.PrimaryKey = "Wrong" }},
		{"changed template", func(p *AttributeViewRelationItemPreview) { p.TemplateID = "missing" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := *preview
			test.change(&p)
			for _, useInputName := range []bool{false, true} {
				if _, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Search", cells, &p, useInputName); err == nil {
					t.Fatal("invalid preview accepted")
				}
			}
			after, _ := json.Marshal(readAttributeViewItemsTest(t, fixture.target.ID))
			if string(before) != string(after) {
				t.Fatal("invalid preview changed target")
			}
		})
	}
	for _, invalid := range []*AttributeViewRelationItemCell{{ItemID: "missing"}, {ItemID: fixture.itemIDs[0], RelatedItemIDs: []string{"missing"}}} {
		if _, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Search", []*AttributeViewRelationItemCell{invalid}, preview, false); err == nil {
			t.Fatal("invalid source or related item accepted")
		}
	}
	created, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Search", cells, preview, false)
	if err != nil || created.Content != preview.PrimaryKey {
		t.Fatalf("preview time changed during creation: %+v %v", created, err)
	}
	if ids := readAttributeViewItemsTest(t, fixture.source.ID).GetValue(fixture.keyID, cells[0].ItemID).Relation.BlockIDs; !slices.Equal(ids, []string{created.ItemID}) {
		t.Fatalf("unexpected relation: %v", ids)
	}
}

func TestAttributeViewRelationItemPreservesExistingAndRollsBack(t *testing.T) {
	fixture := setupRelationItemTest(t, nil)
	cells := []*AttributeViewRelationItemCell{{ItemID: fixture.itemIDs[0]}}
	create := func(name string) *CreateAttributeViewItemResult {
		preview := PreviewAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, name)
		result, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, name, cells, preview, false)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	first := create("Existing")
	cells[0].RelatedItemIDs = []string{first.ItemID}
	second := create("Another")
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, fixture.source.ID).GetValue(fixture.keyID, cells[0].ItemID), first.ItemID, second.ItemID)
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(second.Transaction.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, fixture.source.ID).GetValue(fixture.keyID, cells[0].ItemID), first.ItemID)
	sourceBefore, _ := json.Marshal(readAttributeViewItemsTest(t, fixture.source.ID))
	targetBefore, _ := json.Marshal(readAttributeViewItemsTest(t, fixture.target.ID))
	options := &attributeViewItemCreationOptions{templateTime: time.Now(), primaryFallback: "Failed", expectedPrimary: "Failed",
		operations: func(id string) (do, undo []*Operation) {
			return []*Operation{
				{Action: "updateAttrViewCell", AvID: fixture.source.ID, BlockID: fixture.sourceBlockID,
					KeyID: fixture.keyID, RowID: cells[0].ItemID, Data: &av.Value{Relation: &av.ValueRelation{BlockIDs: []string{id}}}},
				{Action: "updateAttrViewCell", AvID: fixture.source.ID, BlockID: fixture.sourceBlockID,
					KeyID: "missing", RowID: cells[0].ItemID, Data: &av.Value{}},
			}, nil
		},
	}
	if _, err := createAttributeViewItem(fixture.target.ID, fixture.targetBlockID, "", "", "", "", nil, options); err == nil {
		t.Fatal("injected transaction failure was accepted")
	}
	sourceAfter, _ := json.Marshal(readAttributeViewItemsTest(t, fixture.source.ID))
	targetAfter, _ := json.Marshal(readAttributeViewItemsTest(t, fixture.target.ID))
	if string(sourceBefore) != string(sourceAfter) || string(targetBefore) != string(targetAfter) {
		t.Fatalf("failed creation did not restore databases\nsource before=%s\nsource after=%s\ntarget before=%s\ntarget after=%s", sourceBefore, sourceAfter, targetBefore, targetAfter)
	}
}
