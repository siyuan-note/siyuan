//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupListConversionTest(t *testing.T, markdown, binding string) (*fileOperationTestFixture, *av.AttributeView, *parse.Tree, *ast.Node) {
	t.Helper()
	fixture, view, _, _ := setupAttributeViewItemsTest(t, false)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	_, parsed := NewLute().Md2BlockDOMTree(markdown, false)
	list := parsed.Root.ChildByType(ast.NodeList)
	if list == nil {
		t.Fatal("missing list fixture")
	}
	tree.Root.AppendChild(list)
	for index, item := range listConversionItems(list) {
		if index >= len(view.GetBlockKeyValues().Values) {
			break
		}
		node := item
		if binding == "paragraph" {
			node = firstListConversionBlock(item)
		}
		if binding == "list" {
			node = list
			if index > 0 {
				break
			}
		}
		if binding == "none" {
			break
		}
		primary := view.GetBlockKeyValues().Values[index]
		primary.IsDetached, primary.Block.ID, primary.Block.RefSubtype = false, node.ID, "s"
		primary.Block.Content = "Static primary " + fmt.Sprint(index)
		node.SetIALAttr(av.NodeAttrNameAvs, view.ID)
		node.SetIALAttr(av.NodeAttrViewStaticText+"-"+view.ID, primary.Block.Content)
	}
	persistListConversionTest(t, tree, view)
	return fixture, view, tree, list
}

func persistListConversionTest(t *testing.T, tree *parse.Tree, view *av.AttributeView) {
	t.Helper()
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
}

func listConversionTestTx(rootID string, ids []string, typ string, recursive bool) *Transaction {
	return &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "convertList", ID: rootID, BlockIDs: ids,
		Data: apicontract.TransactionListConversion{Type: typ, Level: 5, Recursively: recursive}}}}
}

func TestListConversionBindingReplay(t *testing.T) {
	for _, binding := range []string{"item", "paragraph", "list"} {
		for _, marker := range []string{"- ", "3. ", "- [x] "} {
			t.Run(binding+marker, func(t *testing.T) {
				markdown := marker + "Alpha\n" + marker + "Beta\n"
				if binding == "list" {
					markdown = marker + "Alpha\n"
				}
				fixture, view, original, list := setupListConversionTest(t, markdown, binding)
				before := blockSwapFingerprint(original.Root)
				var targets []string
				for _, item := range listConversionItems(list) {
					targets = append(targets, firstListConversionBlock(item).ID)
				}
				tx := listConversionTestTx(original.ID, []string{list.ID}, "heading", false)
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				entry := GlobalUndoLog.Peek(fixture.sourceID)
				if entry == nil {
					t.Fatal("missing authoritative undo")
				}
				encoded, _ := json.Marshal(tx)
				if strings.Contains(string(encoded), "Static primary") {
					t.Fatal("private binding snapshot leaked")
				}
				for cycle := 0; cycle < 3; cycle++ {
					current := readAttributeViewItemsTest(t, view.ID)
					assertListConversionFields(t, view, current)
					for i, id := range targets {
						value := current.GetBlockKeyValues().Values[i]
						if value.BlockID != view.GetBlockKeyValues().Values[i].BlockID || value.Block.ID != id || value.Block.RefSubtype != "s" || value.Block.Content != fmt.Sprint("Static primary ", i) {
							t.Fatal("row identity or static text changed")
						}
						tree, err := LoadTreeByBlockID(id)
						if err != nil {
							t.Fatal(err)
						}
						node := treenode.GetNodeInTree(tree, id)
						if node.Type != ast.NodeHeading || node.HeadingLevel != 5 || node.IALAttr(av.NodeAttrNameAvs) != view.ID {
							t.Fatal("heading binding missing")
						}
					}
					replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
					tree, err := LoadTreeByBlockID(original.ID)
					if err != nil || blockSwapFingerprint(tree.Root) != before {
						t.Fatalf("list undo did not restore original: %v", err)
					}
					assertAttributeViewItemsEqual(t, view, readAttributeViewItemsTest(t, view.ID))
					replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
				}
			})
		}
	}
}

func TestListConversionNestedBindings(t *testing.T) {
	for _, recursive := range []bool{false, true} {
		t.Run(fmt.Sprint(recursive), func(t *testing.T) {
			_, view, tree, list := setupListConversionTest(t, "- Alpha\n  - Inner\n- Beta\n", "item")
			nested := list.FirstChild.ChildByType(ast.NodeList)
			item := nested.FirstChild
			primary := view.GetBlockKeyValues().Values[2]
			primary.IsDetached, primary.Block.ID = false, item.ID
			primary.Block.Content, primary.Block.RefSubtype = "Inner static", "s"
			item.SetIALAttr(av.NodeAttrNameAvs, view.ID)
			item.SetIALAttr(av.NodeAttrViewStaticText+"-"+view.ID, primary.Block.Content)
			persistListConversionTest(t, tree, view)
			before := blockSwapFingerprint(tree.Root)
			tx := listConversionTestTx(tree.ID, []string{list.ID}, "heading", recursive)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			current := readAttributeViewItemsTest(t, view.ID)
			boundID := item.ID
			if recursive {
				boundID = firstListConversionBlock(item).ID
			}
			if current.GetBlockKeyValues().Values[2].Block.ID != boundID {
				t.Fatal("nested item binding changed incorrectly")
			}
			assertListConversionFields(t, view, current)
			replayAttributeViewFieldsTest(t, tx.UndoOperations)
			restored, err := LoadTreeByBlockID(tree.ID)
			if err != nil || blockSwapFingerprint(restored.Root) != before {
				t.Fatalf("nested list undo did not restore original: %v", err)
			}
			assertAttributeViewItemsEqual(t, view, readAttributeViewItemsTest(t, view.ID))
		})
	}
}

func TestListConversionAtomicRejection(t *testing.T) {
	for _, failure := range []string{"list", "duplicate", "write", "history", "readonly", "stale", "batch"} {
		t.Run(failure, func(t *testing.T) {
			_, view, tree, list := setupListConversionTest(t, "- Alpha\n- Beta\n", "item")
			ids := []string{list.ID}
			if failure == "batch" {
				_, parsed := NewLute().Md2BlockDOMTree("- Gamma\n- Delta\n", false)
				second := parsed.Root.ChildByType(ast.NodeList)
				tree.Root.AppendChild(second)
				second.SetIALAttr(av.NodeAttrNameAvs, view.ID)
				value := view.GetBlockKeyValues().Values[2]
				value.IsDetached, value.Block.ID = false, second.ID
				ids = append(ids, second.ID)
			}
			if failure == "list" {
				list.SetIALAttr(av.NodeAttrNameAvs, view.ID)
				value := view.GetBlockKeyValues().Values[2]
				value.IsDetached, value.Block.ID = false, list.ID
			}
			if failure == "duplicate" {
				paragraph := firstListConversionBlock(list.FirstChild)
				paragraph.SetIALAttr(av.NodeAttrNameAvs, view.ID)
				value := view.GetBlockKeyValues().Values[2]
				value.IsDetached, value.Block.ID = false, paragraph.ID
			}
			if failure == "readonly" {
				list.SetIALAttr("custom-sy-readonly", "true")
			}
			if failure == "stale" {
				view.GetBlockKeyValues().Values[0].IsDetached = true
			}
			persistListConversionTest(t, tree, view)
			filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
			before, _ := os.ReadFile(filename)
			tx := listConversionTestTx(tree.ID, ids, "heading", false)
			if failure == "write" {
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected write failure") }
			}
			if failure == "history" {
				util.HistoryDir = filename
			}
			if err := PerformTxSync(tx); err == nil {
				t.Fatal("unsafe conversion accepted")
			}
			after, _ := os.ReadFile(filename)
			if !bytes.Equal(before, after) {
				t.Fatal("failed conversion changed the document")
			}
			assertAttributeViewItemsEqual(t, view, readAttributeViewItemsTest(t, view.ID))
			if GlobalUndoLog.Peek(tree.ID) != nil {
				t.Fatal("failed conversion entered undo log")
			}
		})
	}
}

func TestListConversionUndoPreservesFieldsAndRejectsRebinding(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		t.Run(fmt.Sprint(conflict), func(t *testing.T) {
			_, view, tree, list := setupListConversionTest(t, "- Alpha\n", "item")
			tx := listConversionTestTx(tree.ID, []string{list.ID}, "heading", false)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			current := readAttributeViewItemsTest(t, view.ID)
			listConversionTextValue(current).Text.Content = "Later field edit"
			if conflict {
				current.GetBlockKeyValues().Values[0].Block.ID = tree.ID
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			err := PerformTxSync(&Transaction{isReplay: true, DoOperations: tx.UndoOperations})
			if conflict != (err != nil) {
				t.Fatalf("unexpected undo result: %v", err)
			}
			if got := listConversionTextValue(readAttributeViewItemsTest(t, view.ID)).Text.Content; got != "Later field edit" {
				t.Fatal("undo overwrote later fields")
			}
		})
	}
}

func TestListConversionHistoryRestoresBinding(t *testing.T) {
	_, view, tree, list := setupListConversionTest(t, "- Alpha\n- Beta\n", "item")
	tx := listConversionTestTx(tree.ID, []string{list.ID}, "heading", false)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", tree.Box, tree.ID+".sy"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("paired history missing: %v %v", paths, err)
	}
	current := readAttributeViewItemsTest(t, view.ID)
	listConversionTextValue(current).Text.Content = "Later field edit"
	if err = av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	originalWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.HistoryDir)
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
	relative, err := filepath.Rel(util.WorkspaceDir, paths[0])
	if err != nil {
		t.Fatal(err)
	}
	err = RollbackDocHistory(relative)
	// 等待历史恢复的异步索引刷新，确保临时数据库不会提前关闭。
	time.Sleep(100 * time.Millisecond)
	sql.FlushQueue()
	if err != nil {
		t.Fatal(err)
	}
	current = readAttributeViewItemsTest(t, view.ID)
	if current.GetBlockKeyValues().Values[0].Block.ID != list.FirstChild.ID || listConversionTextValue(current).Text.Content != "Later field edit" {
		t.Fatal("history did not preserve row identity and later fields")
	}
}

func TestListConversionLargeBatch(t *testing.T) {
	markdown := strings.Repeat("- Entry\n", 150)
	_, view, tree, list := setupListConversionTest(t, markdown, "none")
	for _, kv := range view.KeyValues {
		if len(kv.Values) == 0 {
			continue
		}
		sample := kv.Values[0].Clone()
		kv.Values = nil
		for index, item := range list.ChildrenByType(ast.NodeListItem) {
			value := sample.Clone()
			value.ID, value.BlockID = ast.NewNodeID(), item.ID
			if value.Block != nil {
				value.IsDetached, value.Block.ID = false, item.ID
				value.Block.Content, value.Block.RefSubtype = item.Text(), "d"
				item.SetIALAttr(av.NodeAttrNameAvs, view.ID)
			}
			kv.Values = append(kv.Values, value)
			if kv.Key.Type == av.KeyTypeBlock {
				for _, v := range view.Views {
					if index == 0 {
						v.ItemIDs = nil
					}
					v.ItemIDs = append(v.ItemIDs, item.ID)
				}
			}
		}
	}
	persistListConversionTest(t, tree, view)
	tx := listConversionTestTx(tree.ID, []string{list.ID}, "heading", false)
	start := time.Now()
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	t.Logf("150 bound list items converted in %s", time.Since(start))
	current, err := LoadTreeByBlockID(tree.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.Root.ChildrenByType(ast.NodeHeading)) != 150 {
		t.Fatal("lost converted headings")
	}
	assertListConversionFields(t, view, readAttributeViewItemsTest(t, view.ID))
	if err = PerformTxSync(&Transaction{DoOperations: tx.UndoOperations, isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertAttributeViewItemsEqual(t, view, readAttributeViewItemsTest(t, view.ID))
}

func listConversionTextValue(view *av.AttributeView) *av.Value {
	for _, kv := range view.KeyValues {
		if kv.Key.Type == av.KeyTypeText {
			return kv.Values[0]
		}
	}
	return nil
}

func TestAttributeViewGroupRegenerationIdentity(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layout), func(t *testing.T) {
			_, view, _ := setupAttributeViewGroupMoveTest(t, av.LayoutTypeTable, "B")
			if layout == av.LayoutTypeList {
				util.AttrViewLangs[util.Lang]["list"] = "List"
				for _, v := range view.Views {
					if v.LayoutType == av.LayoutTypeTable {
						v.LayoutType, v.List, v.Table = av.LayoutTypeList, v.Table, nil
						genAttrViewGroups(v, view)
					}
				}
			}
			before, err := cloneAttributeViewForFieldMutation(view)
			if err != nil {
				t.Fatal(err)
			}
			for cycle := 0; cycle < 10; cycle++ {
				regenAttrViewGroups(view)
				for i, v := range view.Views {
					for j, group := range v.Groups {
						original := before.Views[i].Groups[j]
						if group.ID != original.ID || attrViewGroupLayoutID(group) != attrViewGroupLayoutID(original) || !reflect.DeepEqual(group.GroupItemIDs, original.GroupItemIDs) {
							t.Fatal("regeneration changed group identity or order")
						}
					}
				}
			}
		})
	}
}

func assertListConversionFields(t *testing.T, expected, actual *av.AttributeView) {
	t.Helper()
	copy, err := cloneAttributeViewForFieldMutation(expected)
	if err != nil {
		t.Fatal(err)
	}
	for i, primary := range copy.GetBlockKeyValues().Values {
		current := actual.GetBlockKeyValues().Values[i]
		if primary.ID != current.ID || primary.BlockID != current.BlockID || primary.KeyID != current.KeyID {
			t.Fatal("primary identity changed")
		}
		copy.GetBlockKeyValues().Values[i] = current.Clone()
	}
	assertAttributeViewFieldsTest(t, copy, actual)
}
