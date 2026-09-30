//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAttributeViewItemIconLifecycle(t *testing.T) {
	fixture, view, binding := setupAttributeViewBindingUndoTest(t, false)
	itemID := binding.DoOperations[0].PreviousID
	keyID := view.GetBlockKeyValues().Key.ID
	update := func(data any) *av.Value {
		t.Helper()
		value, err := UpdateAttributeViewCell(nil, view.ID, keyID, itemID, data)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	assertIcon := func(want string, detached bool) {
		t.Helper()
		value := readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID)
		if value.Block.Icon != want || value.IsDetached != detached {
			t.Fatalf("unexpected persisted item: %+v, block: %+v", value, value.Block)
		}
	}
	for _, icon := range []string{"1f680", "", "1f600"} {
		update(map[string]any{"block": map[string]any{"icon": icon}})
		assertIcon(icon, true)
	}
	update(map[string]any{"block": map[string]any{"content": "Renamed"}})
	assertIcon("1f600", true)

	// 已有文档使用自身图标，取消绑定保留最后显示的图标。
	for index, blockID := range []string{fixture.sourceID, fixture.targetID} {
		icon := []string{"1f4c4", "1f4d6"}[index]
		tree, err := LoadTreeByBlockID(blockID)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("icon", icon)
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			if err = PerformTxSync(binding); err != nil {
				t.Fatal(err)
			}
		} else {
			update(map[string]any{"isDetached": false, "block": map[string]any{"id": blockID}})
		}
		assertIcon(icon, false)
	}
	update(map[string]any{"isDetached": true, "block": map[string]any{"content": "Detached"}})
	assertIcon("1f4d6", true)
	update(map[string]any{"block": map[string]any{"icon": "1f680"}})
	assertIcon("1f680", true)
	tree, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	if tree.Root.IALAttr("icon") != "1f4d6" {
		t.Fatal("editing a detached item changed the previously bound document icon")
	}
}

func TestAttributeViewItemIconBindingInheritance(t *testing.T) {
	for _, method := range []string{"transaction", "replace", "batch", "cell"} {
		t.Run(method, func(t *testing.T) {
			fixture, view, binding := setupAttributeViewBindingUndoTest(t, false)
			itemID := binding.DoOperations[0].PreviousID
			tree, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			heading := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 2}
			heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
			tree.Root.AppendChild(heading)
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			switch method {
			case "transaction":
				binding.DoOperations[0].NextID = heading.ID
				err = PerformTxSync(binding)
			case "replace":
				_, _, err = replaceAttributeViewBlock(view.ID, itemID, heading.ID, false, nil)
			case "batch":
				err = BatchReplaceAttributeViewBlocks(view.ID, false, []map[string]string{{itemID: heading.ID}})
			case "cell":
				_, err = UpdateAttributeViewCell(nil, view.ID, view.GetBlockKeyValues().Key.ID, itemID,
					map[string]any{"isDetached": false, "block": map[string]any{"id": heading.ID}})
			}
			if err != nil {
				t.Fatal(err)
			}
			assertIcon := func(icon string) {
				t.Helper()
				node, _, loadErr := getNodeByBlockID(nil, heading.ID)
				if loadErr != nil || node.IALAttr("icon") != icon {
					t.Fatalf("block icon was not restored: %v, %q", loadErr, node.IALAttr("icon"))
				}
			}
			assertIcon("1f600")
			if value := readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID); value.Block.Icon != "1f600" || value.IsDetached {
				t.Fatalf("bound entry lost inherited icon: %+v", value)
			}
			if method != "transaction" {
				return
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			for cycle := 0; cycle < 2; cycle++ {
				if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				assertIcon("")
				assertAttributeViewItemsEqual(t, view, readAttributeViewItemsTest(t, view.ID))
				if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				assertIcon("1f600")
			}
			node, tree, err := getNodeByBlockID(nil, heading.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err = setNodeAttrs(node, tree, map[string]string{"icon": "1f680"}); err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
				t.Fatal(err)
			}
			assertIcon("1f680")
		})
	}
}

func TestAttributeViewItemIconTemplateAndCreatedDocument(t *testing.T) {
	fixture := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
	view := database.attrView
	template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Entry", TargetType: av.NewItemTargetDetached,
		Icon: "1f600", PrimaryKeyTemplate: "Entry"}
	if err := view.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	created, err := CreateAttributeViewItem(view.ID, database.nodes[0].ID, view.Views[0].ID, template.ID, "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, operations := range [][]*Operation{created.Transaction.UndoOperations, created.Transaction.DoOperations} {
		if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(operations), isReplay: true}); err != nil {
			t.Fatal(err)
		}
	}
	if value := readAttributeViewItemsTest(t, view.ID).GetBlockValue(created.ItemID); value.Block.Icon != "1f600" || !value.IsDetached {
		t.Fatalf("template icon missing after redo: %+v", value)
	}
	docs, err := CreateAttributeViewItemDocs(view.ID, database.nodes[0].ID, CreateAttributeViewItemDocsSaveModeSubDoc, []string{created.ItemID})
	if err != nil {
		t.Fatal(err)
	}
	assertBoundIcon := func() {
		t.Helper()
		value := readAttributeViewItemsTest(t, view.ID).GetBlockValue(created.ItemID)
		tree, loadErr := LoadTreeByBlockID(docs.BlockIDs[0])
		if loadErr != nil || value.IsDetached || value.Block.Icon != "1f600" || tree.Root.IALAttr("icon") != "1f600" {
			t.Fatalf("new document did not inherit entry icon: %+v, %v", value, loadErr)
		}
	}
	assertBoundIcon()
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(docs.Transaction.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if value := readAttributeViewItemsTest(t, view.ID).GetBlockValue(created.ItemID); !value.IsDetached || value.Block.Icon != "1f600" {
		t.Fatalf("undo lost detached entry icon: %+v", value)
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(docs.Transaction.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertBoundIcon()
	stored := readAttributeViewItemsTest(t, view.ID)
	documentTemplate := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Document", TargetType: av.NewItemTargetDocument,
		Icon: "1f4c4", PrimaryKeyTemplate: "Document"}
	stored.NewItemTemplates = append(stored.NewItemTemplates, documentTemplate)
	stored.DefaultTemplateID = documentTemplate.ID
	if err = av.SaveAttributeView(stored); err != nil {
		t.Fatal(err)
	}
	for _, hasIcon := range []bool{true, false} {
		item, createErr := CreateAttributeViewItem(view.ID, database.nodes[0].ID, view.Views[0].ID, template.ID, "", "")
		if createErr != nil {
			t.Fatal(createErr)
		}
		want := "1f600"
		if !hasIcon {
			want = "1f4c4"
			if _, err = UpdateAttributeViewCell(nil, view.ID, view.GetBlockKeyValues().Key.ID, item.ItemID,
				map[string]any{"block": map[string]any{"icon": ""}}); err != nil {
				t.Fatal(err)
			}
		}
		createdDocs, createErr := CreateAttributeViewItemDocs(view.ID, database.nodes[0].ID,
			CreateAttributeViewItemDocsSaveModeTemplate, []string{item.ItemID})
		if createErr != nil {
			t.Fatal(createErr)
		}
		tree, loadErr := LoadTreeByBlockID(createdDocs.BlockIDs[0])
		if loadErr != nil || tree.Root.IALAttr("icon") != want {
			t.Fatalf("template icon priority: want %q, error %v", want, loadErr)
		}
		if currentTemplate := readAttributeViewItemsTest(t, view.ID).GetNewItemTemplate(documentTemplate.ID); currentTemplate.Icon != "1f4c4" {
			t.Fatal("creating a document changed the shared item template icon")
		}
	}
}
